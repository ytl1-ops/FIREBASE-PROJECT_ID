import type { CapacitorConfig } from "@capacitor/cli";

// Application téléphone : la version autonome (dist/) embarquée dans une application native.
const config: CapacitorConfig = {
  appId: "app.monmeeting",
  appName: "MonMeeting",
  webDir: "dist",
  android: { allowMixedContent: false },
};

export default config;
