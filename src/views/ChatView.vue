<script setup lang="ts">
import SessionList from "../components/SessionList.vue";
import Transcript from "../components/Transcript.vue";
import Composer from "../components/Composer.vue";
import { useSessionsStore } from "../stores/sessions";

const sessions = useSessionsStore();
</script>

<template>
  <div class="flex h-full min-h-0">
    <SessionList />
    <section class="flex min-w-0 flex-1 flex-col">
      <header class="flex h-12 items-center border-b border-outline-gray-1 px-6">
        <div class="truncate text-sm font-medium text-ink-gray-8">
          {{
            sessions.sessions.find((s) => s.id === sessions.activeId)?.title ||
            (sessions.activeId ? "Chat" : "New chat")
          }}
        </div>
      </header>
      <Transcript />
      <Composer />
    </section>
  </div>
</template>
