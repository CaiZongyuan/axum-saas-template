# 备份自己的业务并验证独立恢复

部署完成后，需要证明自己的业务数据、Files 对象和排队任务能够一起恢复。Backup Archive 是维护窗口内的数据库一致性快照、已核对的 ready 对象、清单和报告；文档导出或直接复制卷目录都不能替代它。

本指南需要已部署的生产组合、Docker Compose、受保护的环境文件和足够的归档空间。所有命令在仓库根目录运行。备份会停止应用写入者，恢复会创建新的持久卷。

## 让自己的业务进入备份合同

| 数据位置                           | 备份责任                                                    |
| ---------------------------------- | ----------------------------------------------------------- |
| 本部署 PostgreSQL 中的业务 schema  | 随完整数据库 dump 保存，包括迁移历史、Session、Job 和 Audit |
| 通过 Files 发布的 ready 对象       | 按 `saas_core.files` 的键、大小与 sha256 核对，下载后入档   |
| pending 上传                       | 暂存对象不入档；恢复后按 TTL 过期，由幂等清理任务处理       |
| 自行引入的外部数据库或直接写入对象 | 当前工具不覆盖；扩展清单、核对与演练后才能承诺恢复          |
| 密钥与部署配置                     | 不入档；由部署方独立、安全地提供                            |

新增业务应通过 Files 管理文件状态，让对象内容不可变、归属明确。归档包含数据库中的业务数据，虽然不含部署密钥，也需要访问控制与保留策略。

## 停写、排空并创建归档

```bash
just production-backup .env.production
```

可用第二个位置参数指定归档目录：

```bash
just production-backup .env.production backups/release-before-upgrade
```

[备份脚本](../../scripts/production-backup.mjs)先停止 API，要求日志出现 `draining HTTP requests` 并在 25 秒前退出，低于 Compose 的 30 秒宽限期；随后停止 Worker，要求 `stopping worker claims and draining current work` 并在 40 秒前退出，低于 45 秒宽限期。达到停止预算或对象核对失败会让备份失败。数据库中的 queued Job 保留，窗口内不继续认领。

写入者停止后，工具执行 `pg_dump -Fc`，读取 ready 文件登记，逐个下载并核对 sha256 和大小。多余未引用对象记录在报告中；缺失或不符的 ready 对象使归档不一致。

归档内应有：

```text
database.dump
manifest.json
objects/
backup-report.md
```

`manifest.json` 记录应用镜像/digest、迁移版本和对象清单。检查报告 PASS 与明细后，可用 `just production-up .env.production` 恢复原栈运行。

## 在独立空环境恢复

停止生产组合以释放 80/443，保留其卷：

```bash
just production-down .env.production
just production-restore backups/release-before-upgrade .env.production
```

Restore Environment 默认使用不同的 Compose 项目名、新网络和新卷；工具拒绝与生产相同的项目名。停止生产组合仅释放端口，不要求删除生产数据。恢复后是否切换流量是一个显式部署决定，工具不会替你覆盖生产卷。

[恢复脚本](../../scripts/production-restore.mjs)依次启动依赖、执行 `pg_restore --no-owner --exit-on-error`、初始化桶、启动 Caddy、按清单上传对象，再启动 API/Worker。准备归档对应的镜像与受保护配置；它不会自动下载历史镜像，也不会隐式执行新迁移。

最终检查 readiness、迁移版本与桶清单，写 `restore-report.md`，保留恢复栈供检查。如果 `pg_restore` 失败，目标可能已部分写入：销毁这个失败的独立恢复项目后重新创建，不要向同一半成品库反复叠加恢复。

## 给自己的业务增加恢复断言

结构核对通过后，从真实 HTTPS API 验证至少一个完整业务结果：

1. 恢复前创建具有已知字段值的资源，记录其 id、版本和可访问账号。
2. 若业务有文件，上传已知字节并完成发布。
3. 停 Worker 后通过公开 API 排队一个任务，再备份。
4. 恢复后登录或使用恢复的 Session，读取资源并比对字段、版本和文件字节。
5. 等 Worker 完成原 queued Job，读取业务结果；验证失败/撤权路径不会额外发布对象。
6. 在演练中让 pending 上传到期，确认其终态与暂存对象清理。

现有[自动演练](../../scripts/production-restore-drill.mjs)用参考应用验证同一条备份/恢复命令：账号、文档、附件逐字节、排队导出、pending 到期和清理。它会创建测试项目及密钥，结束删除自己的卷、环境文件与临时证书，把报告留在 `.scratch/`；需要空闲 80/443。读者新增业务不自动包含在此旅程中，应按上面的行为加入断言。

## 检查与排错

```bash
node --test tests/tooling/backup-sigv4.test.mjs tests/tooling/backup-manifest.test.mjs
just production-restore-drill
```

清单检查和 SigV4 测试无需 Docker；演练使用真实生产组合。端口冲突时先确认哪个组合在占用；不要用删除卷解决监听冲突。对象不符时保留报告，检查 Files 登记与实际对象。缺失部署密钥时从受保护配置恢复，不能从归档推导。

这些工具属于 SaaS Core；移除参考业务不会移除备份/恢复能力。下一步：[把自己的恢复断言接入测试反馈循环](../testing/t01-feedback-loop.md)。
