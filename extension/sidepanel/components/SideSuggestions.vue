<script setup lang="ts">
withDefaults(
  defineProps<{
    disabled?: boolean;
  }>(),
  { disabled: false },
);

const emit = defineEmits<{
  pick: [prompt: string];
}>();

const suggestions = [
  "Summarize this page",
  "Create a project timeline",
  "Develop a marketing strategy",
  "Help me brainstorm",
  "Craft a professional email",
];
</script>

<template>
  <div
    class="flex flex-col items-start gap-2.5 px-1 pt-2"
    :class="disabled ? 'pointer-events-none opacity-45' : ''"
  >
    <button
      v-for="item in suggestions"
      :key="item"
      type="button"
      class="side-suggestion"
      :disabled="disabled"
      @click="emit('pick', item)"
    >
      <span class="side-suggestion-icon" aria-hidden="true">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path
            d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
          />
          <circle cx="9" cy="11" r="0.75" fill="currentColor" stroke="none" />
          <circle cx="12.5" cy="11" r="0.75" fill="currentColor" stroke="none" />
          <circle cx="16" cy="11" r="0.75" fill="currentColor" stroke="none" />
        </svg>
      </span>
      <span>{{ item }}</span>
    </button>
  </div>
</template>
