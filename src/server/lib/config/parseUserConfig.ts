import { type UserConfig, userConfigSchema } from "./config";

export const parseUserConfig = (configJson: string | undefined): UserConfig => {
  const parsed: UserConfig = (() => {
    try {
      return userConfigSchema.parse(JSON.parse(configJson ?? "{}"));
    } catch {
      return userConfigSchema.parse({});
    }
  })();

  if (parsed.enterKeyBehavior === "shift-enter-send") {
    return {
      ...parsed,
      enterKeyBehavior: "enter-send",
    };
  }

  return parsed;
};
