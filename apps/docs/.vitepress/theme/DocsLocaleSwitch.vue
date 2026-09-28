<script setup lang="ts">
import { computed } from 'vue';
import { useData, withBase } from 'vitepress';

// The language switcher pairs chapters through the `counterpart` value the
// renderer writes into every page's frontmatter. Pages without a
// translation fall back to the other locale's documentation entry, so the
// switch never lands on a page that does not exist.
const { frontmatter, lang } = useData();
const isEnglish = computed(() => lang.value === 'en');
const counterpart = computed(() =>
  withBase(String(frontmatter.value.counterpart ?? '/')),
);
</script>

<template>
  <div
    class="docs-locale-switch"
    role="group"
    :aria-label="isEnglish ? 'Switch language' : '切换语言'"
    :lang="isEnglish ? 'zh-CN' : 'en'"
  >
    <a
      v-if="isEnglish"
      class="docs-locale-link"
      :href="counterpart"
      title="切换到简体中文"
      >中文</a
    >
    <span v-else class="docs-locale-current" lang="zh-CN">中文</span>
    <span class="docs-locale-divider" aria-hidden="true">·</span>
    <a
      v-if="!isEnglish"
      class="docs-locale-link"
      :href="counterpart"
      lang="en"
      title="Switch to English"
      >English</a
    >
    <span v-else class="docs-locale-current" lang="en">English</span>
  </div>
</template>

<style scoped>
.docs-locale-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  white-space: nowrap;
}
.docs-locale-link {
  color: var(--vp-c-brand-1);
  text-decoration: none;
}
.docs-locale-link:hover {
  text-decoration: underline;
}
.docs-locale-current {
  color: var(--vp-c-text-1);
  font-weight: 600;
}
.docs-locale-divider {
  color: var(--vp-c-text-3);
}
</style>
