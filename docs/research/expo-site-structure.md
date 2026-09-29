# Expo 公开站点信息架构：模板站点参考

查证日期：2026-09-27。范围：Expo 官方首页、文档首页、博客列表与一篇文章、Expo Go 与 Orbit 下载入口。本文为设计调查，不改变已确认的产品范围。用户后续明确 Blog 与 Downloads 本轮仅提供中英文 Coming soon；下文有关文章列表和真实下载的观察仅作未来参考，不纳入当前实现票。本模板公开站点采用 Landing、Documentation、Blog、Downloads。Landing 的视觉方向已于 2026-09-29 由用户确认改为借鉴 Expo 的展示级版面（display 标题、mono 事实条、bento 卡与收尾容器；展示动画仍不采用），chrome 与诚实边界见 [UI 设计](../ui/design.md)；本文其余部分保留调查时的证据与当时结论。

## 1. 调查方法与证据边界

本次使用 `curl -L` 获取官方页面，并用 Python 标准库 `html.parser` 提取服务器返回的标题、正文、链接、可访问名称与响应式 class。下列六个来源在调查时均返回 HTTP 200。内容与顺序依据返回 HTML 中相应内容区域，不依据搜索摘要或第三方文章。[S1][home] [S2][docs] [S3][blog] [S4][post] [S5][go] [S6][orbit]

当前没有可用的浏览器工具，未执行 JavaScript、未拍摄截图，也没有验证菜单展开、轮播播放、搜索结果、加载更多、设备检测、下载完成或各视口的实际布局。HTML 的响应式 class 是实现意图证据，不能替代真实浏览器验收。博客响应包含加载占位和后续内容，不能将原始响应中的 footer/占位顺序误当作最终视觉顺序。

## 2. Expo 当前的导航与分流

| 区域 | 本次读取到的事实 | 来源 |
| --- | --- | --- |
| 首页顶栏 | 主要入口包含 Docs、Product、Solutions、Enterprise、Pricing、Blog；另有 GitHub、Log in、Sign up。Product 和 Solutions 是按钮入口；GitHub 链接指向 `github.com/expo/expo`，登录、注册分别为 `/login`、`/signup`。 | [首页][home] |
| 产品导航内容 | 返回 HTML 包含 Dev tools、Services、Explore 分组。Dev tools 中有 Expo SDK、Expo CLI、Expo MCP、Expo Go、Snack、Orbit；Services 中有 Workflows、Build、Submit、Update、Hosting、Launch、Observe、Simulators；Explore 中有 Changelog、Expo Services、Contact。这里只确认内容，未验证菜单展开方式。 | [首页][home] |
| Documentation | 首页 Docs 指向独立的 `https://docs.expo.dev`。文档站保留返回 Expo、Blog、Changelog 和 GitHub 的入口，内容导航包括 Home、Guides、EAS、Reference、Learn。 | [首页][home]、[文档首页][docs] |
| Blog | 首页 Blog 指向同域 `/blog`。博客拥有列表页和 `/blog/<slug>` 文章路径，与面向任务和 API 的文档站分开。 | [首页][home]、[博客][blog]、[文章样本][post] |
| 下载入口 | 此次首页顶栏没有名为 Downloads 的总入口；产品导航中的 Expo Go 和 Orbit 分别指向 `/go`、`/orbit`。本模板的 Downloads 是本项目已选范围，不是照抄 Expo 顶栏。 | [首页][home]、[Expo Go][go]、[Orbit][orbit] |
| 页脚 | 按 Product、Resources、Solutions、Company、Legal 分组，Resources 重复提供 Documentation、Blog、Changelog 等入口；另含 newsletter、状态与主题选择控件。 | [首页][home] |

可借鉴的是不同阅读任务有稳定入口：首页解释价值，文档帮助上手和查阅，博客承载阶段性内容，下载页面交付安装入口。Expo 的独立文档子域是其部署事实，不构成本模板必须采用多域名、Next.js 或新内容系统的理由。

## 3. 首页内容顺序与主要行动

以下顺序来自首页内容区域的 HTML；标题为调查时原文。每项事实均来自 [Expo 首页][home]。

| 顺序 | Expo 内容 | 面向本模板的设计推论 |
| --- | --- | --- |
| 1 | 主标题 “Build beautiful apps that keep getting better”；主按钮 Get started 链接到 `/signup?redirect_uri=/new`，次按钮为 Talk to our team；附近还有 Try Observe 的产品更新入口。随后说明从开发、测试到发布和反馈的完整过程。 | 首屏用一句话说明模板解决什么、面向谁，并提供清晰的开始路径。建议主动作进入快速开始文档，次动作查看源码；最终文案与链接由项目设计决定。无需照搬销售咨询或注册转化漏斗。 |
| 2 | 开发者数量、GitHub stars 和 “Trusted in Production By” 证明区。 | 如无真实采用证据，省略社会证明；可以展示可核验的仓库、示例运行和验证入口。 |
| 3 | “Building blocks for agentic workflows”，按 Develop、Test、Deploy、Monitor 四个阶段组织能力；HTML 含 Resume autoplay 控件。 | 借鉴按用户任务串联能力：启动模板、构建业务、验证、部署和维护。阶段与内容以仓库真实能力为准，不需要实现同款轮播。 |
| 4 | Expo SDK、MCP、生产 API、原生代码兼容等能力入口；链接到 SDK 文档、GitHub 和具体能力页。 | 把模板基础能力与可移除业务示例分清；每个能力说明连接到实际教程或参考，避免只有展示卡片而无后续阅读路径。 |
| 5 | “Infrastructure for your apps”；下分构建/分发、更新、模拟器、上架、监控、工作流等能力，Learn more 连接到对应服务或文档。 | 用少量事实说明开发、运行、部署的完整路径；不宣称模板提供 Expo 的托管基础设施。 |
| 6 | 下载量、活跃开发者、项目和构建规模指标；“Expo is a community”、Discord 和开发者评价。 | 没有对应证据时不展示数字、客户 logo、评价或认证徽章。简洁的源码/讨论/问题入口已经足够。 |
| 7 | 末尾 “Build beautiful native apps” 再次提供 Get started，目标为 `/new`；其后有资格/合规标志及完整页脚。 | 页面末尾重复与首屏一致的主要行动，再提供 Documentation、Blog、Downloads、GitHub 等真实链接。不要为参考的布局填入不存在的认证或商业承诺。 |

“Get started” 在首屏与末尾的实际目标不完全相同；这属于 Expo 自身的账户/创建流程。本模板应明确自己的主要行动及目标，而不是只复制按钮文字。[首页][home]

## 4. Documentation、Blog 与 Downloads 可借鉴的具体结构

### Documentation：先给可执行起点，再分学习与查阅

文档首页具有 “Search or Ask AI” 入口和快捷键提示，并以 Quick Start 开始。其后提供通用应用教程、上架、CI/CD、CLI 部署、更多教程与能力探索，再给 API、示例和社区入口。侧栏的上手顺序是 Create a project → Set up your environment → Start developing → Next steps，后续按开发、评审、部署和监控等任务组织。[文档首页][docs]

**本模板建议：** 保留已存在的快速开始、纵向教程、架构/运行参考作为文档职责；公开 Landing 不重复整套文档正文。文档中保留全站导航以及清晰的章节导航、站内搜索和当前页定位。Expo 的 Ask AI、EAS、SDK 版本选择等入口仅说明其自身产品能力，不自动成为本模板范围。

### Blog：未来能力参考，本轮仅 Coming soon

博客页返回了精选文章区、最新文章、类别筛选和 Load more 按钮。列表条目包含标题、发布日期、作者，部分精选条目还显示摘要与阅读时长。调查时类别包括 All、AI、Development、Product、React Native、Security notices、Users；类别名称与文章数量属于 Expo 当时的内容库。[博客][blog]

文章样本有独立 H1、分节正文、分享入口、Useful links 和 Related articles。文章发布日期为 2026-09-22；本调查仅用其页面结构，不评价该文声称的产品效果。[文章样本][post]

**本模板建议：** 博客列表与文章页即可形成第一版，文章提供标题、日期、摘要和正文。分类、推荐、分页随实际内容规模添加，不预造文章数量或空类别。双语内容和语言切换应与公开站点约定一致，技术教程仍由 Documentation 负责，不在 Blog 中建立第二份相同正文。

### Downloads：未来能力参考，本轮仅 Coming soon

Expo Go 页面让用户选择 SDK version，并区分 Android、iOS、Android Emulator、iOS Simulator 安装入口；同时说明 Expo Go 是学习环境与 sandbox，提供迁移到 development build 的指南。本次 HTML 中安装元素没有可提取的最终 `href`，故不能据此确认各安装包实际链接或下载行为。[Expo Go][go]

Orbit 页面提供 “Download for macOS” 到 `https://expo.dev/orbit/download/macos`，同时提供 All releases、Documentation 和 GitHub；All releases 指向 `https://github.com/expo/orbit/releases`。这是本次未执行 JS 的默认响应所呈现的入口，不足以断言其所有支持平台或自动识别行为。[Orbit][orbit]

**本模板建议：** Downloads 按本项目真实发布物列出版本、平台/架构、安装说明与发布记录链接。只展示已经存在的下载资产；没有对应资产的组合不提供虚构按钮。是否列源码包、Desktop 或其他交付物，依据发布流程确定，不从 Expo 的平台支持反推本项目的支持范围。

## 5. 移动结构：HTML 能证实什么

| 官方 HTML 证据 | 可以得出的有限结论 | 仍需真实浏览器验证 |
| --- | --- | --- |
| 首页顶栏链接带 `max-md:hidden`，另有 `aria-label="Open menu"` 按钮。 | 代码提供窄屏隐藏常规导航及菜单触发入口。 | 菜单实际布局、完整性、键盘焦点、关闭方式、触摸命中范围。 |
| 首页 hero 容器默认 `flex-col`，在 `lg:` / `xl:` 使用多列 grid；主要动作默认纵向，在 `lg:` 改横向。 | 首屏布局意图是在窄屏堆叠内容与动作。 | 实际换行、图像裁切、屏幕内首屏高度、动效与阅读顺序。 |
| 首页能力区默认 `grid-cols-1`，在更宽断点切换两列；页脚存在 `max-lg:flex-col`。 | 内容与导航可按断点改变列数。 | 最小视口是否横向溢出、字号和间距是否可读。 |
| 文档页有 `aria-label="Toggle navigation menu"`、Theme selector，内容 grid 使用 `max-md:grid-cols-1`，代码块包含 `overflow-x-auto`。 | 代码中存在导航折叠入口、主题控件、单列内容与代码局部横滚结构。 | 折叠菜单焦点管理、搜索弹层、长代码与页面滚动的实际配合。 |
| 博客条目网格有 `max-md:grid-cols-1`，分类栏容器有 `overflow-x-auto`。 | 窄屏文章列表意图变单列，分类可局部横滚。 | 分类是否能触摸/键盘到达、筛选和 Load more 的动态行为。 |

上述证据分别来自 [首页][home]、[文档首页][docs]、[博客][blog]。这里只保留 class 标识，不假设其断点对应某个确定的像素值。

**本模板建议：** 四个顶层入口在窄屏仍可到达，Landing 单列递进、文档导航折叠、博客单列、下载选项不挤成过窄列。继承中英文与亮暗主题，标题、按钮和导航需覆盖较长英文及中文。该建议需要项目自身的浏览器验收，不以 Expo 的 HTML 代替测试。

## 6. 对 SaaS 模板的最小结构建议

这部分是设计推论，不是 Expo 的站点事实，也不替代用户对项目范围的确认。

```text
公开站点
├── Landing：定位 → 可核验能力 → 启动与扩展路径 → 文档/下载分流 → 开始行动
├── Documentation：快速开始 → 纵向教程 → 架构与运行参考
├── Blog：Coming soon → 返回首页 / 文档
└── Downloads：Coming soon → 返回首页 / 文档
```

- 全站导航只呈现已选范围；标志返回 Landing，文档、博客、下载各有稳定路径。GitHub 可作为外部资源；登录/进入应用如提供，应有明确用途和可用目标。
- Landing 维持中性色表面、少量主要动作、细线分隔和小面积语义色。借鉴 Expo 的信息递进与分流；2026-09-29 用户确认 Landing 采用其展示级排版与卡片几何（大字号、药丸、大圆角 bento），展示动画仍不复制——该决定取代本行原有的「不复制大字号、装饰性卡片几何」约束，营销元素红线不变。
- 主动作建议“开始使用”直达可执行的快速开始文档；次动作建议查看源码。未来发布安装包后可由 Downloads 承接，本轮该入口显示 Coming soon；避免把所有动作堆在首屏。
- Core 能力、可移除示例和未实现能力必须区分；删除某示例时，其独占 Landing 文案、教程、博客引用或下载说明也应按项目组合规则处理。
- Blog 第一版不因此引入 CMS、评论、订阅或内容编辑后台；Downloads 不因此引入自动更新服务。需要这些能力时单独决策。

不应复制 Expo 的 React Native/SDK/EAS/Simulator/MCP 产品能力、销售咨询、商业定价、客户 logo、用户评价、合规/推荐标志，或其 “3M+ developers”“50K+ GitHub stars”“7M+ weekly downloads”“80%” 等营销数字。它们是 Expo 在调查时的展示内容，不是本模板的证据或承诺。[首页][home]

## 官方来源

- S1：[Expo 首页][home]，导航、CTA、内容顺序、响应式标记及页脚。
- S2：[Expo Documentation][docs]，文档信息架构、学习/参考分流及响应式标记。
- S3：[Expo Blog][blog]，精选/列表、文章元信息、类别和加载入口。
- S4：[What if your app could fix itself?][post]，文章页结构样本。
- S5：[Expo Go][go]，设备/SDK 安装入口及产品定位。
- S6：[Expo Orbit][orbit]，下载、全部发布、文档和源码分流。

[home]: https://expo.dev/
[docs]: https://docs.expo.dev/
[blog]: https://expo.dev/blog
[post]: https://expo.dev/blog/agent-fixes-bugs-on-eas-simulator
[go]: https://expo.dev/go
[orbit]: https://expo.dev/orbit
