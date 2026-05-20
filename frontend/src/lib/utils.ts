// Utility simple sin dependencia de clsx (PoC)
export function cn(...inputs: (string | undefined | null | false)[]) {
  return inputs.filter(Boolean).join(" ");
}
