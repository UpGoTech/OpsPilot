import { createRouter, createWebHistory } from "vue-router";

/**
 * Shell owns the main surface (history / workspace / agent).
 * Settings opens as an overlay from the top bar — no separate route needed.
 */
export const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: "/:pathMatch(.*)*", name: "home", component: { template: "<div />" } }],
});
