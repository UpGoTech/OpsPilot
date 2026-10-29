<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string;
    active?: boolean;
    disabled?: boolean;
  }>(),
  { active: false, disabled: false },
);

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();
</script>

<template>
  <button
    type="button"
    class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40"
    :class="
      active
        ? 'bg-[#e8e8e8] text-[#1e1e1e]'
        : 'text-[#6b6b6b] hover:bg-[#ebebeb] hover:text-[#3c3c3c]'
    "
    :title="title"
    :aria-label="title"
    :disabled="disabled"
    @click="emit('click', $event)"
  >
    <slot />
  </button>
</template>
