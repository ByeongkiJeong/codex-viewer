import { zodResolver } from "@hookform/resolvers/zod";
import { Trans } from "@lingui/react";
import { SettingsIcon, TrashIcon } from "lucide-react";
import { type FC, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { CodexTurnOptionsSchema } from "@/server/core/codex-runtime/schema";
import {
  type CodexOptionsForm,
  codexOptionsFormSchema,
  hasNonDefaultCodexTurnOptions,
  transformFormToSchema,
  transformSchemaToForm,
} from "./codexOptionsFormSchema";

type CodexSettingsFormProps = {
  value: CodexTurnOptionsSchema | undefined;
  onChange: (value: CodexTurnOptionsSchema | undefined) => void;
  disabled?: boolean;
  showForkOption?: boolean;
  forkSession?: boolean;
  onForkSessionChange?: (fork: boolean) => void;
};

const isApprovalPolicy = (
  value: string,
): value is NonNullable<CodexOptionsForm["approvalPolicy"]> => {
  return (
    value === "untrusted" ||
    value === "on-failure" ||
    value === "on-request" ||
    value === "never"
  );
};

const isSandboxMode = (
  value: string,
): value is NonNullable<CodexOptionsForm["sandboxMode"]> => {
  return (
    value === "readOnly" ||
    value === "workspaceWrite" ||
    value === "dangerFullAccess"
  );
};

const EnvEditor: FC<{
  value: Record<string, string | undefined>;
  disabled: boolean;
  onChange: (value: Record<string, string | undefined>) => void;
}> = ({ value, disabled, onChange }) => {
  const entries = Object.entries(value);

  const updateKey = (oldKey: string, newKey: string) => {
    const next: Record<string, string | undefined> = {};
    for (const [key, val] of entries) {
      if (key === oldKey) {
        next[newKey] = val;
      } else {
        next[key] = val;
      }
    }
    onChange(next);
  };

  const updateValue = (key: string, nextValue: string) => {
    onChange({ ...value, [key]: nextValue });
  };

  const remove = (key: string) => {
    const next = { ...value };
    delete next[key];
    onChange(next);
  };

  const add = () => {
    onChange({ ...value, "": "" });
  };

  return (
    <div className="space-y-2">
      {entries.map(([key, val]) => (
        <div
          key={key === "" ? "__empty_env_key__" : key}
          className="flex items-center gap-2"
        >
          <Input
            value={key}
            onChange={(event) => updateKey(key, event.target.value)}
            placeholder="KEY"
            disabled={disabled}
            className="h-8 text-xs"
          />
          <Input
            value={val ?? ""}
            onChange={(event) => updateValue(key, event.target.value)}
            placeholder="VALUE"
            disabled={disabled}
            className="h-8 text-xs"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => remove(key)}
            disabled={disabled}
            className="h-8 w-8 p-0"
          >
            <TrashIcon className="w-3.5 h-3.5" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        disabled={disabled}
        className="h-7 text-xs"
      >
        <Trans id="settings.env.add" />
      </Button>
    </div>
  );
};

export const CodexSettingsForm: FC<CodexSettingsFormProps> = ({
  value,
  onChange,
  disabled = false,
  showForkOption = false,
  forkSession = true,
  onForkSessionChange,
}) => {
  const { register, watch, setValue } = useForm<CodexOptionsForm>({
    resolver: zodResolver(codexOptionsFormSchema),
    defaultValues: transformSchemaToForm(value),
  });

  const formData = watch();
  const transformed = useMemo(
    () => transformFormToSchema(formData),
    [formData],
  );

  useEffect(() => {
    onChange(transformed);
  }, [onChange, transformed]);

  const env = formData.env ?? {};

  return (
    <div className="space-y-4 text-sm">
      {showForkOption && onForkSessionChange && (
        <div className="p-3 bg-muted/30 rounded-md">
          <div className="flex items-center gap-2">
            <Checkbox
              id="fork-session-checkbox"
              checked={forkSession}
              onCheckedChange={(checked) =>
                onForkSessionChange(checked === true)
              }
              disabled={disabled}
            />
            <Label
              htmlFor="fork-session-checkbox"
              className="cursor-pointer text-xs"
            >
              <Trans id="settings.forkSession" />
            </Label>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="model" className="text-xs font-medium">
          Model
        </Label>
        <Input
          id="model"
          {...register("model")}
          placeholder="gpt-5-codex"
          disabled={disabled}
          className="h-8 text-xs"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Approval Policy</Label>
        <Select
          value={formData.approvalPolicy}
          onValueChange={(value) => {
            if (isApprovalPolicy(value)) {
              setValue("approvalPolicy", value);
            }
          }}
          disabled={disabled}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Select policy" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="untrusted">untrusted</SelectItem>
            <SelectItem value="on-failure">on-failure</SelectItem>
            <SelectItem value="on-request">on-request</SelectItem>
            <SelectItem value="never">never</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Sandbox Mode</Label>
        <Select
          value={formData.sandboxMode}
          onValueChange={(value) => {
            if (isSandboxMode(value)) {
              setValue("sandboxMode", value);
            }
          }}
          disabled={disabled}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Select sandbox" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="readOnly">readOnly</SelectItem>
            <SelectItem value="workspaceWrite">workspaceWrite</SelectItem>
            <SelectItem value="dangerFullAccess">dangerFullAccess</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="writableRootsText" className="text-xs font-medium">
          Writable Roots (one path per line)
        </Label>
        <Textarea
          id="writableRootsText"
          {...register("writableRootsText")}
          placeholder="/workspace/path"
          disabled={disabled}
          className="min-h-20 text-xs"
        />
      </div>

      <div className="flex items-center justify-between py-1">
        <Label htmlFor="networkAccess" className="text-xs font-medium">
          Network Access
        </Label>
        <Switch
          id="networkAccess"
          checked={formData.networkAccess === true}
          onCheckedChange={(checked) => setValue("networkAccess", checked)}
          disabled={disabled}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Environment</Label>
        <EnvEditor
          value={env}
          disabled={disabled}
          onChange={(next) => setValue("env", next)}
        />
      </div>
    </div>
  );
};

type CodexSettingsPopoverProps = {
  value: CodexTurnOptionsSchema | undefined;
  onChange: (value: CodexTurnOptionsSchema | undefined) => void;
  disabled?: boolean;
  showForkOption?: boolean;
  forkSession?: boolean;
  onForkSessionChange?: (fork: boolean) => void;
};

export const CodexSettingsPopover: FC<CodexSettingsPopoverProps> = ({
  value,
  onChange,
  disabled,
  showForkOption,
  forkSession,
  onForkSessionChange,
}) => {
  const hasSettings = hasNonDefaultCodexTurnOptions(value);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={hasSettings ? "default" : "ghost"}
          size="icon"
          disabled={disabled}
          className="h-8 w-8"
        >
          <SettingsIcon className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[420px] max-h-[70vh] overflow-y-auto"
        align="end"
      >
        <CodexSettingsForm
          value={value}
          onChange={onChange}
          disabled={disabled}
          showForkOption={showForkOption}
          forkSession={forkSession}
          onForkSessionChange={onForkSessionChange}
        />
      </PopoverContent>
    </Popover>
  );
};
