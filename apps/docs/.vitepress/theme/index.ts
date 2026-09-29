import DefaultTheme from 'vitepress/theme';
import DocsLayout from './DocsLayout.vue';
import LandingHeroArt from './LandingHeroArt.vue';
import './custom.css';

// The documentation site shares the application's neutral visual: a
// system font stack for Chinese and English, light-gray navigation over a
// white reading surface, fine borders and a restrained accent. Dark mode
// mirrors the same roles with neutral charcoal surfaces. The default
// locale dropdown is replaced by the frontmatter-driven switcher, which
// never links at chapters without a translation.
export default {
  extends: DefaultTheme,
  Layout: DocsLayout,
  enhanceApp({ app }) {
    // The Landing embeds the hero illustration straight from Markdown;
    // global registration keeps the page sources free of script blocks.
    app.component('LandingHeroArt', LandingHeroArt);
  },
};
