<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { useChatStore } from "../stores/chat";
import MarkdownBody from "./MarkdownBody.vue";
import TurnScaffold from "./TurnScaffold.vue";

const chat = useChatStore();
const scroller = ref<HTMLElement | null>(null);

watch(
  () =>
    chat.turns
      .map(
        (t) =>
          `${t.id}:${t.running}:${t.activity.length}:${t.replies.map((r) => r.content.length).join(",")}`,
      )
      .join("|"),
  async () => {
    await nextTick();
    if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight;
  },
);

function visibleReplies(turn: (typeof chat.turns)[number]) {
  return turn.replies.filter((m) => m.content.trim() || m.streaming);
}

/** Tool stdout/detail — agent often names zips here without a full /opt path. */
function artifactSourcesFor(turn: (typeof chat.turns)[number]): string[] {
  return turn.activity
    .flatMap((step) => [step.detail, step.output, step.label])
    .filter((s): s is string => Boolean(s && s.trim()));
}

async function copyReply(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // ignore
  }
}
</script>

<template>
  <div
    ref="scroller"
    class="agent-transcript min-h-0 flex-1 overflow-y-auto bg-[#f7f7f7] px-3.5 py-3"
  >
    <div
      v-if="chat.loadingHistory"
      class="px-1 py-6 text-[13px] text-[#8a8a8a]"
    >
      Loading…
    </div>

    <div
      v-else-if="!chat.turns.length"
      class="flex h-full min-h-[220px] flex-col items-center justify-center px-6 text-center"
    >
      <div class="text-[14px] font-medium text-[#3c3c3c]">New chat</div>
      <p class="mt-1.5 max-w-[260px] text-[13px] leading-relaxed text-[#8a8a8a]">
        Ask Hermes to work with your remote workspace, files, and ERPNext.
      </p>
    </div>

    <div v-else class="mx-auto flex w-full max-w-[680px] flex-col gap-5">
      <article
        v-for="turn in chat.turns"
        :key="turn.id"
        class="flex flex-col gap-3"
      >
        <!-- User — soft Cursor bubble -->
        <div
          v-if="turn.user"
          class="rounded-[12px] border border-[#e6e6e6] bg-[#ececec] px-3.5 py-2.5"
        >
          <div
            v-if="turn.user.imagePreviews?.length || turn.user.fileLabels?.length"
            class="mb-2 flex flex-wrap gap-2"
          >
            <img
              v-for="(src, i) in turn.user.imagePreviews || []"
              :key="`${turn.id}-img-${i}`"
              :src="src"
              alt=""
              class="h-16 w-16 rounded-md object-cover"
            />
            <div
              v-for="(label, i) in turn.user.fileLabels || []"
              :key="`${turn.id}-file-${i}`"
              class="rounded-md border border-[#e0e0e0] bg-white px-2 py-1 text-[11px] text-[#3c3c3c]"
            >
              {{ label }}
            </div>
          </div>
          <pre
            class="whitespace-pre-wrap break-words font-sans text-[14px] font-normal leading-[1.45] text-[#1a1a1a]"
          >{{ turn.user.content }}</pre>
        </div>

        <TurnScaffold
          v-if="turn.activity.length"
          :steps="turn.activity"
          :live="turn.running"
        />
        <div
          v-else-if="turn.running && !visibleReplies(turn).length"
          class="text-[13px] text-[#8a8a8a]"
        >
          Working…
        </div>

        <!-- Assistant — borderless prose on panel bg -->
        <div
          v-for="message in visibleReplies(turn)"
          :key="message.id"
          class="group"
        >
          <MarkdownBody
            :source="message.content"
            :artifact-sources="artifactSourcesFor(turn)"
            :auto-open-html="message.streaming === true"
          />
          <div
            v-if="message.streaming"
            class="mt-1.5 text-[12px] text-[#8a8a8a]"
          >
            Writing…
          </div>
          <div
            v-else
            class="mt-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
          >
            <button
              type="button"
              class="inline-flex h-6 w-6 items-center justify-center rounded text-[#8a8a8a] hover:bg-[#e8e8e8] hover:text-[#3c3c3c]"
              title="Copy"
              @click="copyReply(message.content)"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
              </svg>
            </button>
          </div>
        </div>
      </article>
    </div>

    <div
      v-if="chat.error"
      class="mx-auto mt-3 max-w-[680px] text-[13px] text-[#c43c3c]"
    >
      {{ chat.error }}
    </div>
  </div>
</template>
