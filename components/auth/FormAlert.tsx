// components/auth/FormAlert.tsx
export function FormAlert({ error, message }: { error?: string | null; message?: string | null }) {
  if (error) {
    return (
      <div role="alert" className="p-3 text-sm rounded-xl bg-[#F26B5B]/10 text-[#B23A2C] border border-[#F26B5B]/30">
        {error}
      </div>
    )
  }
  if (message) {
    return (
      <div role="status" className="p-3 text-sm rounded-xl bg-[#A8D5BA]/30 text-[#0E4D5C] border border-[#A8D5BA]">
        {message}
      </div>
    )
  }
  return null
}
