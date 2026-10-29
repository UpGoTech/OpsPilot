<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";

const props = defineProps<{
  /** Current width of the panel being resized (px). */
  width: number;
  /** Grow when dragging left (right-docked panel). */
  edge?: "left" | "right";
}>();

const emit = defineEmits<{
  resize: [width: number];
}>();

const dragging = ref(false);
let startX = 0;
let startW = 0;

function onPointerDown(event: PointerEvent) {
  dragging.value = true;
  startX = event.clientX;
  startW = props.width;
  (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
}

function onPointerMove(event: PointerEvent) {
  if (!dragging.value) return;
  const delta = event.clientX - startX;
  const next =
    props.edge === "right" ? startW + delta : startW - delta;
  emit("resize", next);
}

function onPointerUp() {
  dragging.value = false;
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
}

onBeforeUnmount(() => {
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
});
</script>

<template>
  <div
    class="group relative z-20 w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-outline-gray-2"
    :class="dragging ? 'bg-outline-gray-3' : ''"
    role="separator"
    aria-orientation="vertical"
    @pointerdown.prevent="onPointerDown"
  >
    <div
      class="pointer-events-none absolute inset-y-0 -left-1 w-3"
    />
  </div>
</template>
