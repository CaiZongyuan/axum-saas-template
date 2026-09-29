---
status: accepted
---

# 采用 Dougong（斗拱）作为项目名

项目长期只有描述性的 "Axum SaaS Template"：它与 GitHub 上已有的同名仓库混淆，也无法指代"这套东西"本身。采用 **Dougong（斗拱）** 作为项目名。斗拱是中国木构建筑中梁柱之间标准化、预制装配的承托构件——不同的屋顶架在同一套构件上，对应本模板的两个核心主张：可复用的 SaaS Core 与可整体移除的参考应用（见[可移除真实示例](0002-executable-removable-reference.md)与[构建时组合参考业务](0003-static-example-composition.md)）。`dougong` 同时是英文建筑文献的既有借词，国际读者无需解释。

备选方向在同一轮调研（2026-09-29，crates.io 与 GitHub 逐一查证）中排除：榫卯（sunmao）的 crate 名在调研当日刚被注册，且已有同名低代码框架；方尖碑（obelisk）、木組み（kigumi）、墨斗（modou）、龙骨（keel）均已有同名 crate；盘古、昆仑、泰山等被大厂命名体系占用。空闲的 Yingzao（营造，《营造法式》的规范意象）保留为备选，若未来需要区分"这件事"（营造）与"那套构件"（斗拱）再启用。

本决定只落地品牌文案层：README（双语）、文档站 `site.json` 的站点与 landing 标题，以及对应的浏览器标题断言。crate 名（`saas-platform`）、仓库 slug（`axum-saas-template`）与 clone、GitHub Pages 链接保持不变，避免与 CI、所有权清单和已发布链接耦合，由后续单独票处理。词汇表与文档正文的"模板"仍是普通名词，品牌名只出现在标题与署名处。
