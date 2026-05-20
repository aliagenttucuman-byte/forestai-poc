import { cn } from "../../lib/utils";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
}

export function Button({ className, variant = "primary", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "px-4 py-2 rounded-lg font-medium transition-colors",
        variant === "primary" && "bg-green-600 hover:bg-green-500 text-white",
        variant === "secondary" && "bg-gray-700 hover:bg-gray-600 text-white",
        variant === "ghost" && "hover:bg-gray-800 text-gray-300",
        className
      )}
      {...props}
    />
  );
}
