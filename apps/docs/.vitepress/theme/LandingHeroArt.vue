<template>
  <!-- Pure geometry with no text: the route a request takes through the
       template (client → API → worker/storage). It reads in both locales
       and both themes because every stroke resolves to a palette token —
       the fine lines to text-3, the accent path and nodes to brand-1. -->
  <svg
    class="landing-hero-art"
    viewBox="0 0 400 320"
    fill="none"
    aria-hidden="true"
  >
    <!-- Request pulses around the client -->
    <path class="art-line" d="M60 118v-12M84 126l8-9M60 178v12M84 170l8 9" />
    <!-- Client -->
    <rect class="art-surface" x="16" y="118" width="88" height="60" rx="10" />
    <line class="art-line" x1="32" y1="136" x2="88" y2="136" />
    <line class="art-line" x1="32" y1="152" x2="72" y2="152" />
    <!-- API service, the accent of the composition -->
    <rect class="art-accent" x="156" y="98" width="100" height="100" rx="12" />
    <line class="art-line" x1="174" y1="124" x2="238" y2="124" />
    <line class="art-line" x1="174" y1="148" x2="228" y2="148" />
    <line class="art-line" x1="174" y1="172" x2="234" y2="172" />
    <!-- Worker -->
    <rect class="art-surface" x="304" y="44" width="80" height="52" rx="10" />
    <line class="art-line" x1="320" y1="64" x2="368" y2="64" />
    <circle class="art-line" cx="336" cy="80" r="5" />
    <!-- Storage -->
    <rect class="art-surface" x="304" y="204" width="80" height="52" rx="10" />
    <ellipse class="art-line" cx="344" cy="224" rx="24" ry="6" />
    <line class="art-line" x1="320" y1="224" x2="320" y2="242" />
    <line class="art-line" x1="368" y1="224" x2="368" y2="242" />
    <!-- Connections and the async job lane -->
    <line class="art-line" x1="104" y1="148" x2="156" y2="148" />
    <line class="art-line" x1="256" y1="122" x2="304" y2="80" />
    <line class="art-line" x1="256" y1="174" x2="304" y2="222" />
    <line class="art-line art-line-dashed" x1="344" y1="96" x2="344" y2="204" />
    <circle class="art-node" cx="130" cy="148" r="3.5" />
    <circle class="art-node" cx="280" cy="101" r="3.5" />
    <circle class="art-node" cx="280" cy="198" r="3.5" />
    <!-- Ground line -->
    <line class="art-line" x1="16" y1="296" x2="384" y2="296" />
  </svg>
</template>

<style scoped>
/* The illustration belongs to the two-column hero; below 960px the hero
   is a single column and the art steps aside. */
.landing-hero-art {
  display: none;
  width: 100%;
  height: auto;
}
@media (min-width: 960px) {
  .landing-hero-art {
    display: block;
  }
}
.art-line {
  stroke: var(--vp-c-text-3);
  stroke-width: 1.5;
  stroke-linecap: round;
}
.art-line-dashed {
  stroke-dasharray: 4 7;
}
.art-surface {
  stroke: var(--vp-c-text-3);
  stroke-width: 1.5;
}
.art-accent {
  stroke: var(--vp-c-brand-1);
  stroke-width: 1.5;
}
.art-node {
  fill: var(--vp-c-brand-1);
}
</style>
