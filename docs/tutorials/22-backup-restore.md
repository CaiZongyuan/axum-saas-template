# 跟做：备份并在独立环境恢复文档、附件与任务

本章回答“生产数据如何备份、如何证明能恢复”。备份不是“把卷目录拷走”，而是一个可审阅的过程：维护窗口内停止新的变更、等待在途请求排空，对数据库做一致性快照，同时按数据库登记核对每一个 ready 对象；恢复则永远进入一个独立的空环境，用归档加受保护配置重建，再用真实 API 旅程证明账号、文档、附件、排队任务都回来了。两条运维命令（`production-backup`、`production-restore`）覆盖日常操作，[自动演练](../../scripts/production-restore-drill.mjs)把“备份→恢复→验证”整条链路做成一条命令，每次运行都从零生成密钥、随机项目名与数据。

## 1. 备份里有什么、没有什么

`just production-backup` 产出的归档 = 数据库快照 + 对象清单 + 清单核对过的对象字节 + 报告：

| 归档内容           | 形式                                                                   |
| ------------------ | ---------------------------------------------------------------------- |
| `database.dump`    | `pg_dump -Fc` 自定义格式，含 `_sqlx_migrations`，可跨版本 `pg_restore` |
| `manifest.json`    | 应用镜像与 digest、迁移版本与数量、每个 ready 文件的 `sha256` 与大小   |
| `objects/`         | 清单里每个 ready 对象的原样字节，逐一按数据库摘要核对后落盘            |
| `backup-report.md` | 结论 PASS/FAIL 与检查明细，供人审阅                                    |

清单只登记 ready 对象是设计使然：ready 对象不可变，且内容摘要就存在数据库里（`saas_core.files.sha256`），所以“数据库快照 + ready 对象”构成一个自洽的一致点——清单与快照互相印证，任何一边缺了都能被发现（多余对象只报告、不判失败，例如尚未清理的暂存键）。pending 上传的暂存对象不在备份里：恢复后它们按 TTL 过期并幂等清理，这正是演练要验证的行为。

密钥不在归档里。`POSTGRES_PASSWORD`、`S3_*`、`MAIL_ENCRYPTION_KEY` 属于受保护配置，恢复时从部署方的环境文件单独提供——丢掉归档不泄露密钥，丢掉环境文件只有归档也进不去数据库。归档与密钥分开保管、分开授权（本地 Caddy 根证书同样能签发入口证书，脚本只把它写进临时目录，绝不入档）。

## 2. 维护窗口：停止变更、排空、快照

```bash
just production-backup ENV_FILE=.env.production   # 归档落在 backups/<时间戳>/
```

[备份脚本](../../scripts/production-backup.mjs)执行完整的窗口序列并掐表：先停 API（停止新的 mutation，宽限期 30s，日志必须出现 `draining HTTP requests`），再停 Worker（在途认领收尾，宽限期 45s，日志必须出现 `stopping worker claims and draining current work`）；任何一个到达 compose 的强杀宽限期而不是自行退出，脚本立即失败。两个写入者都停了，`pg_dump` 拿到的才是无新变更的一致点——“不依赖停 API 就假设暂存 PUT 已停止”的反面要求就是必须真的 drain。窗口期间新请求无法进入，而已在队列里的任务（如导出）保留在数据库任务表中，恢复后由 Worker 认领完成，不丢失。备份结束时栈处于停止状态，照常 `just production-up` 重启即可。

对象侧不需要单独冻结：ready 对象不可变，清单按数据库逐行生成（`state = 'ready'` 的 `ready_key`、`sha256`、`actual_size`），再经入口对桶做 ListObjectsV2 核对。对象操作用[最小 SigV4 实现](../../scripts/lib/sigv4.mjs)以 `S3_PUBLIC_ENDPOINT` 签名——与预签名 URL 同一条路径，其正确性由 AWS 官方 get-vanilla 测试向量逐字节钉住（[测试](../../tests/tooling/backup-sigv4.test.mjs)），并下载每个对象比对数据库摘要后才写入归档。

## 3. 恢复：独立空环境，绝不覆盖

```bash
just production-restore ARCHIVE=backups/20260927-120000 ENV_FILE=.env.production
```

[恢复脚本](../../scripts/production-restore.mjs)的默认目标是独立环境：compose 项目名不同（默认 `axum-saas-production-restore-<时间戳>`），网络与卷全部新建。项目名与生产相同时脚本直接拒绝——同名意味着同卷，那是唯一的覆盖路径；发布端口与生产相同，所以生产组合必须先完全停止，要替换就得显式 `down -v` 旧环境，这个决定永远是人做的。脚本依次：起依赖 → `pg_restore --no-owner --exit-on-error`（半个数据库的“成功恢复”不会静默通过）→ `storage-init` 建桶 → 起入口（对象 PUT 要过 Caddy，签名才有效）→ 按 `manifest.json` 把 `objects/` 逐个签名 PUT 回桶 → 起应用 → 结构核对（就绪、迁移版本与清单一致、桶内容与清单一致），恢复报告落在归档里，恢复栈保持运行供人工检查。应用从不隐式迁移或建桶——恢复环境与首次部署遵守同一契约。

## 4. 演练：自动证明这份归档真的能恢复

```bash
just production-restore-drill
```

[演练脚本](../../scripts/production-restore-drill.mjs)自建镜像、自生成密钥与环境文件（邮件已配置但失联、遥测端点不可达——降级贯穿全程），然后驱动第 2、3 节的同两条命令走完整链路并追加旅程断言：

1. **种子**：注册 owner、写入已知内容的文档、上传已知字节的附件并完成，再开一个**永远不传字段的 pending 上传**作为过期受害者，停 Worker 后排队一个导出。
2. **窗口与备份**：`production-backup` 排空并掐表，产出 dump、清单、核对过的对象与备份报告。
3. **重建**：演练 `down -v` 生产项目腾出端口，`production-restore` 用归档单独重建独立项目。
4. **旅程验证**：原会话 Cookie 依然有效（会话在恢复的数据库里）；文档与附件逐字节读回；排队的导出被恢复后的 Worker 完成为 `succeeded`，zip 内容与原文一致；pending 上传过期到 `expired` 终态，`object_cleanup` 为暂存键登记了 `first_deleted_at`——尽管对象本来就不存在，清理保持幂等；没有任何任务以 `failed` 收场。
5. **报告**：三份报告留在归档里（`drill-report.md`、`backup-report.md`、`restore-report.md`），PASS 之外任何一项失败都会让演练以 `[阶段名]` 前缀报错结束。

上传 TTL 是 15 分钟（`upload_secs` 策略默认值），演练不会干等：它把恢复库里那一行的 `expires_at` 拨到过去，随后的过期、清理入队与幂等删除仍由真实的维护扫描（30 秒周期）与清理任务执行——拨快时钟的是演练，执行状态机的永远是生产代码。

演练是可重复的：项目名带 PID、密钥随机、结束 `down -v` 两个项目并删除环境文件与临时根证书；归档留在 `.scratch/` 下供审阅（其中只有演练数据）。若 80/443 被占，说明生产组合还在运行——先 `just production-down`，这也是“恢复不碰生产”约束的自然排错步骤。[清单逻辑测试](../../tests/tooling/backup-manifest.test.mjs)不需要 Docker 即可验证清单归一化、核对语义与报告渲染。

## 5. 运行本章检查

```bash
node --test tests/tooling/backup-sigv4.test.mjs tests/tooling/backup-manifest.test.mjs
just production-restore-drill
just check
```

本章与单机生产部署一样属于模板核心能力（Core），不在示例所有权清单中登记——备份恢复工具面向任何按模板部署的部署方，不随示例业务删除。备份与恢复是同一工具的两半：演练每次运行都同时证明“这份归档真的能恢复”，这是它比“备份成功”更强的承诺。
