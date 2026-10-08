"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

import { useTheme } from "@/components/theme/theme-provider"

// テーマは next-themes ではなく、このアプリの <html data-theme>（components/theme）に合わせる
const Toaster = ({ ...props }: ToasterProps) => {
  const [theme] = useTheme()

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4 text-signal-strong" />
        ),
        info: (
          <InfoIcon className="size-4 text-info-strong" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4 text-caution-strong" />
        ),
        error: (
          <OctagonXIcon className="size-4 text-destructive-strong" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast font-sans",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
