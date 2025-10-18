<template>
  <!-- SVG Gradients -->
  <div id="gradients">
    <svg v-for="(gradient, index) in gradients" :key="index" width="0" height="0">
      <linearGradient :id="gradient.team" x1="50%" y1="100%" x2="50%" y2="0%">
        <stop offset="0%" :style="{ 'stop-color': gradient.end, 'stop-opacity': 1 }" />
        <stop offset="100%" :style="{ 'stop-color': gradient.start, 'stop-opacity': 1 }" />
      </linearGradient>
    </svg>
  </div>
</template>

<script setup lang="ts">
import type { Gradient } from '@/types';
import { ref } from 'vue';

const gradients = ref<Gradient[]>([
  { team: "demon", start: "#ce0100", end: "#000" },
  { team: "townsfolk", start: "#1f65ff", end: "#000" },
  { team: "minion", start: "#ff6900", end: "#000" },
  { team: "default", start: "#4E4E4E", end: "#000" },
]);
</script>

<style lang="scss" scoped>
svg {
  position: absolute;
  z-index: -1;
}
</style>
