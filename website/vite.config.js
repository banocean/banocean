import { defineConfig } from "npm:vite@8.3.1";
import { activityPlugin } from "./generateActivityPage.js";

export default defineConfig({
    root: "src",
    plugins: [activityPlugin()],
});
