<script setup lang="ts">
import { nextTick, onMounted, reactive, ref, watch } from "vue";
import { Button, FormControl } from "frappe-ui";
import { useErpnextStore } from "../stores/erpnext";

const emit = defineEmits<{
  success: [];
  changeSite: [];
}>();

const erpnext = useErpnextStore();

const form = reactive({
  usr: "",
  pwd: "",
});
const submitting = ref(false);
const message = ref<string | null>(null);
const pwdField = ref<HTMLElement | null>(null);

function hydrateUsername() {
  if (!form.usr.trim() && erpnext.lastUsername.trim()) {
    form.usr = erpnext.lastUsername.trim();
  }
}

watch(
  () => erpnext.lastUsername,
  () => hydrateUsername(),
  { immediate: true },
);

onMounted(async () => {
  hydrateUsername();
  await nextTick();
  // If username is remembered, jump focus to password.
  if (form.usr.trim()) {
    const root = pwdField.value;
    const input = root?.querySelector?.("input") as HTMLInputElement | null;
    input?.focus();
  }
});

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error("Could not reach ERPNext"));
    }, ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function onSubmit() {
  submitting.value = true;
  message.value = null;
  try {
    const session = await withTimeout(erpnext.login(form.usr, form.pwd), 10_000);
    form.pwd = "";
    if (!session) {
      message.value = "Sign in failed. Check your username and password.";
      return;
    }
    emit("success");
  } catch (error) {
    form.pwd = "";
    // Stay on the login screen for bad credentials / network errors.
    message.value = error instanceof Error ? error.message : String(error);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-10">
    <div class="w-full max-w-sm">
      <h1 class="text-xl font-semibold tracking-tight text-ink-gray-9">
        Sign in
      </h1>
      <p class="mt-1 text-sm text-ink-gray-6">
        Use your ERPNext account for
        <span class="font-medium text-ink-gray-8">{{ erpnext.siteUrl }}</span>
      </p>

      <form class="mt-8 flex flex-col gap-4" @submit.prevent="onSubmit">
        <FormControl
          v-model="form.usr"
          type="text"
          label="Email / Username"
          placeholder="you@company.com"
          autocomplete="username"
        />
        <div ref="pwdField">
          <FormControl
            v-model="form.pwd"
            type="password"
            label="Password"
            autocomplete="current-password"
          />
        </div>

        <div v-if="message" class="text-sm text-ink-red-4">
          {{ message }}
        </div>

        <Button
          type="submit"
          variant="solid"
          class="mt-1 w-full"
          :loading="submitting"
          :disabled="!form.usr.trim() || !form.pwd"
          :label="submitting ? 'Signing in…' : 'Sign in'"
        />
      </form>

      <button
        type="button"
        class="mt-6 text-sm text-ink-gray-6 underline-offset-2 hover:text-ink-gray-8 hover:underline"
        @click="emit('changeSite')"
      >
        Change ERPNext site URL
      </button>
    </div>
  </div>
</template>
