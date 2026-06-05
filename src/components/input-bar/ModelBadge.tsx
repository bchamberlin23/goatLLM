import { ModelPicker } from "../ModelPicker";

interface ModelBadgeProps {
  onOpenSettings?: () => void;
}

export function ModelBadge({ onOpenSettings }: ModelBadgeProps) {
  return <ModelPicker onOpenSettings={onOpenSettings} />;
}
