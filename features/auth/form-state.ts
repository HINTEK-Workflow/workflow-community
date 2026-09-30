export type AuthFormState = {
  status: "idle" | "success" | "error";
  message?: string;
};

export const initialAuthFormState: AuthFormState = {
  status: "idle",
};
