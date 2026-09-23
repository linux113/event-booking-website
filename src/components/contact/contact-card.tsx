import { contactIcons } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { ContactChannel } from "@/types";

type ContactCardProps = {
  channel: ContactChannel;
  className?: string;
};

export function ContactCard({ channel, className }: ContactCardProps) {
  const ChannelIcon = contactIcons[channel.icon];

  return (
    <a
      href={channel.href}
      target={channel.external ? "_blank" : undefined}
      rel={channel.external ? "noopener noreferrer" : undefined}
      className={cn(
        "border-border bg-surface/60 hover:border-marigold/45 group flex h-full flex-col gap-3 rounded-2xl border p-5 transition-colors duration-200",
        className,
      )}
    >
      <span className="from-violet/30 to-rani/20 text-marigold-soft ring-border/80 flex size-11 items-center justify-center rounded-xl bg-gradient-to-br ring-1">
        <ChannelIcon className="size-5" />
      </span>

      <span className="flex flex-col gap-1">
        <span className="text-muted/80 text-[0.6875rem] font-semibold tracking-widest uppercase">
          {channel.label}
        </span>
        <span className="text-sm font-semibold break-words">{channel.value}</span>
      </span>

      {channel.description ? (
        <span className="text-muted text-sm/6">{channel.description}</span>
      ) : null}
    </a>
  );
}
