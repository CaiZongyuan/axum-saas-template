<script setup lang="ts">
import DefaultTheme from 'vitepress/theme';
import DocsLocaleSwitch from './DocsLocaleSwitch.vue';

const { Layout } = DefaultTheme;
</script>

<template>
  <Layout>
    <template #nav-bar-content-before>
      <DocsLocaleSwitch class="docs-locale-nav" />
    </template>
    <template #nav-screen-content-before>
      <DocsLocaleSwitch class="docs-locale-screen" />
    </template>
    <template #sidebar-nav-before>
      <DocsLocaleSwitch class="docs-locale-sidebar" />
    </template>
  </Layout>
</template>

<style>
.docs-locale-nav {
  margin-right: 12px;
}
.docs-locale-screen {
  display: block;
  padding: 0 24px 8px;
}
.docs-locale-sidebar {
  display: none;
  padding: 8px 24px 0;
}
@media (max-width: 959px) {
  .docs-locale-sidebar.docs-locale-sidebar {
    display: block;
  }
}
</style>
