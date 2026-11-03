import {
  Bot,
  Brain,
  BriefcaseBusiness,
  ChartNoAxesCombined,
  Code2,
  Compass,
  Database,
  Feather,
  Headset,
  Lightbulb,
  MessageSquareText,
  Microscope,
  PenLine,
  Rocket,
  Scale,
  Search,
  Sparkles,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';

export const assistantIcons: Record<string, LucideIcon> = {
  Sparkles,
  ChartNoAxesCombined,
  Headset,
  Code2,
  Bot,
  Brain,
  MessageSquareText,
  PenLine,
  Search,
  Database,
  WandSparkles,
  Compass,
  Microscope,
  Scale,
  Rocket,
  Lightbulb,
  BriefcaseBusiness,
  Feather,
};

export const assistantIconNames = Object.keys(assistantIcons);

export function getAssistantIcon(name: string): LucideIcon {
  return assistantIcons[name] ?? Sparkles;
}

export const colorOptions = [
  '#5EEAD4',
  '#38BDF8',
  '#A78BFA',
  '#FBBF24',
  '#F472B6',
  '#34D399',
  '#FB7185',
  '#94A3B8',
];
