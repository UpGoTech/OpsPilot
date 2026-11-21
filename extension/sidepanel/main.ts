import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "../../src/router";
import "../../src/style.css";
import "./sidepanel.css";

createApp(App).use(createPinia()).use(router).mount("#app");
