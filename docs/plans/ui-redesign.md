# UI 与官网重构：规格与实现票

正式规格：[[Spec] 可组合示例的 UI 与官网重构：双语设计系统、Landing 与教程](https://github.com/CaiZongyuan/axum-saas-template/issues/57)。GitHub 是唯一状态来源；本索引记录已批准的拆分与发布结果，不表示实现已经完成。

## 开工条件

用户要求当前已有实现票全部完成并集成后再开发本轮。起始 UI01 原生阻塞于 [#29](https://github.com/CaiZongyuan/axum-saas-template/issues/29)，#29 已阻塞于 [#28](https://github.com/CaiZongyuan/axum-saas-template/issues/28)；其余所有本轮票传递继承该条件。开始时核对成果确已合入默认分支，ready-for-agent 标签不表示无阻塞。规格票不作为待关闭实现任务。

## 范围

公开站点为 Landing / Documentation / Blog / Downloads；本轮交付 Landing 与完整双语 Documentation，Blog 和 Downloads 仅为中英文 Coming soon 页面，正式功能以后另行规划。

设计见 [UI 设计](../ui/design.md)，架构取舍见 [ADR 0003](../adr/0003-static-example-composition.md)，Expo 参考见 [站点结构调查](../research/expo-site-structure.md)。

## 已发布实现票

UI 编号保持已审阅拆分；UI15 为最后集成验收，需等待新增 UI16。

| 实现票 | 交付行为 | Blocked by |
| --- | --- | --- |
| [UI01 · #58](https://github.com/CaiZongyuan/axum-saas-template/issues/58) | 阅读中英文快速开始与生成参考 | [#29](https://github.com/CaiZongyuan/axum-saas-template/issues/29) |
| [UI02 · #59](https://github.com/CaiZongyuan/axum-saas-template/issues/59) | 从统一应用壳打开零、单、双示例组合 | [#58](https://github.com/CaiZongyuan/axum-saas-template/issues/58) |
| [UI03 · #60](https://github.com/CaiZongyuan/axum-saas-template/issues/60) | 按示例 id 移除业务并保持其他组合可运行 | [#59](https://github.com/CaiZongyuan/axum-saas-template/issues/59) |
| [UI04 · #61](https://github.com/CaiZongyuan/axum-saas-template/issues/61) | 在身份流程和通用设置切换语言与亮暗外观 | [#59](https://github.com/CaiZongyuan/axum-saas-template/issues/59) |
| [UI05 · #62](https://github.com/CaiZongyuan/axum-saas-template/issues/62) | 在设置中操作生产组件与可移除演示场景 | [#61](https://github.com/CaiZongyuan/axum-saas-template/issues/61) |
| [UI06 · #63](https://github.com/CaiZongyuan/axum-saas-template/issues/63) | 用双语工作区浏览文档、知识库与授权 | [#61](https://github.com/CaiZongyuan/axum-saas-template/issues/61) |
| [UI07 · #64](https://github.com/CaiZongyuan/axum-saas-template/issues/64) | 在双栏编辑器显式保存并保护冲突草稿 | [#62](https://github.com/CaiZongyuan/axum-saas-template/issues/62), [#63](https://github.com/CaiZongyuan/axum-saas-template/issues/63) |
| [UI08 · #65](https://github.com/CaiZongyuan/axum-saas-template/issues/65) | 在文档上下文上传、下载和删除附件 | [#62](https://github.com/CaiZongyuan/axum-saas-template/issues/62), [#63](https://github.com/CaiZongyuan/axum-saas-template/issues/63) |
| [UI09 · #66](https://github.com/CaiZongyuan/axum-saas-template/issues/66) | 跟踪文档导出并阅读可回退的双语通知 | [#62](https://github.com/CaiZongyuan/axum-saas-template/issues/62), [#63](https://github.com/CaiZongyuan/axum-saas-template/issues/63) |
| [UI10 · #67](https://github.com/CaiZongyuan/axum-saas-template/issues/67) | 在统一界面管理企业成员和 API Keys | [#61](https://github.com/CaiZongyuan/axum-saas-template/issues/61) |
| [UI11 · #68](https://github.com/CaiZongyuan/axum-saas-template/issues/68) | 在双语管理区追踪任务、审计和系统状态 | [#61](https://github.com/CaiZongyuan/axum-saas-template/issues/61) |
| [UI12 · #69](https://github.com/CaiZongyuan/axum-saas-template/issues/69) | 按申请语言发送并完成密码重置 | [#61](https://github.com/CaiZongyuan/axum-saas-template/issues/61) |
| [UI13 · #70](https://github.com/CaiZongyuan/axum-saas-template/issues/70) | 让桌面连接错误页延续应用语言与主题 | [#61](https://github.com/CaiZongyuan/axum-saas-template/issues/61) |
| [UI14 · #71](https://github.com/CaiZongyuan/axum-saas-template/issues/71) | 用中英文完成工程与运维学习路径 | [#58](https://github.com/CaiZongyuan/axum-saas-template/issues/58) |
| [UI15 · #73](https://github.com/CaiZongyuan/axum-saas-template/issues/73) | 验收完整 UI 与多示例独立增减 | [#60](https://github.com/CaiZongyuan/axum-saas-template/issues/60), [#64](https://github.com/CaiZongyuan/axum-saas-template/issues/64), [#65](https://github.com/CaiZongyuan/axum-saas-template/issues/65), [#66](https://github.com/CaiZongyuan/axum-saas-template/issues/66), [#67](https://github.com/CaiZongyuan/axum-saas-template/issues/67), [#68](https://github.com/CaiZongyuan/axum-saas-template/issues/68), [#69](https://github.com/CaiZongyuan/axum-saas-template/issues/69), [#70](https://github.com/CaiZongyuan/axum-saas-template/issues/70), [#71](https://github.com/CaiZongyuan/axum-saas-template/issues/71), [#72](https://github.com/CaiZongyuan/axum-saas-template/issues/72) |
| [UI16 · #72](https://github.com/CaiZongyuan/axum-saas-template/issues/72) | 从双语 Landing 进入文档与 Coming soon 页面 | [#58](https://github.com/CaiZongyuan/axum-saas-template/issues/58) |
| [UI17 · #109](https://github.com/CaiZongyuan/axum-saas-template/issues/109) | 整修公开站共享 chrome：顶栏、语言药丸、三态外观、占位页容器 | [#57](https://github.com/CaiZongyuan/axum-saas-template/issues/57), [#58](https://github.com/CaiZongyuan/axum-saas-template/issues/58), [#60](https://github.com/CaiZongyuan/axum-saas-template/issues/60) |
| [UI18 · #110](https://github.com/CaiZongyuan/axum-saas-template/issues/110) | Landing 视觉重构：Expo 式版面（display hero、事实条、bento、收尾容器） | [#57](https://github.com/CaiZongyuan/axum-saas-template/issues/57), [#58](https://github.com/CaiZongyuan/axum-saas-template/issues/58), [#60](https://github.com/CaiZongyuan/axum-saas-template/issues/60), [#109](https://github.com/CaiZongyuan/axum-saas-template/issues/109) |

每票包含完整验收条件、公开测试入口、双语在线教程与示例所有权要求。实施按真实阻塞关系推进，完成集成后关闭相应实现票；父规格在拆票过程中保持不变。
