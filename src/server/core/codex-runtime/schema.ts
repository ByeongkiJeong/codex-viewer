import { z } from "zod";

export const mediaTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export type MediaType = z.infer<typeof mediaTypeSchema>;

const imageBlockSchema = z.object({
  type: z.literal("image"),
  source: z.object({
    type: z.literal("base64"),
    media_type: mediaTypeSchema,
    data: z.string(),
  }),
});

const documentBlockSchema = z.object({
  type: z.literal("document"),
  source: z.union([
    z.object({
      type: z.literal("text"),
      media_type: z.literal("text/plain"),
      data: z.string(),
    }),
    z.object({
      type: z.literal("base64"),
      media_type: z.literal("application/pdf"),
      data: z.string(),
    }),
  ]),
});

export type ImageBlockParam = z.infer<typeof imageBlockSchema>;
export type DocumentBlockParam = z.infer<typeof documentBlockSchema>;

export const userMessageInputSchema = z.object({
  text: z.string().min(1),
  images: z.array(imageBlockSchema).optional(),
  documents: z.array(documentBlockSchema).optional(),
});

export type UserMessageInputSchema = z.infer<typeof userMessageInputSchema>;

export const codexApprovalPolicySchema = z.enum([
  "untrusted",
  "on-failure",
  "on-request",
  "never",
]);

export const codexSandboxModeSchema = z.enum([
  "readOnly",
  "workspaceWrite",
  "dangerFullAccess",
]);

export const codexTurnOptionsSchema = z.object({
  model: z.string().optional(),
  approvalPolicy: codexApprovalPolicySchema.optional(),
  sandboxMode: codexSandboxModeSchema.optional(),
  writableRoots: z.array(z.string()).optional(),
  networkAccess: z.boolean().optional(),
  env: z.record(z.string(), z.string().optional()).optional(),
});

export type CodexTurnOptionsSchema = z.infer<typeof codexTurnOptionsSchema>;
