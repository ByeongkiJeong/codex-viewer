const internalBootstrapPrefixes = [
  "# AGENTS.md instructions for ",
  "<environment_context>",
  "<permissions instructions>",
];

export const isInternalBootstrapMessage = (text: string): boolean => {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return true;
  }

  return internalBootstrapPrefixes.some((prefix) => trimmed.startsWith(prefix));
};
