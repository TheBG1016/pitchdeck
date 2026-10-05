export class AppError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function responseError(error: unknown): Response {
  if (error instanceof AppError) return Response.json({ error: error.message }, { status: error.status });
  if (error && typeof error === "object" && "code" in error && error.code === "23505") return Response.json({ error: "An email or registration number is already in use. Check your CSV or team details." }, { status: 409 });
  if (error && typeof error === "object" && "code" in error && error.code === "22P02") return Response.json({ error: "Invalid identifier or value." }, { status: 400 });
  if (error && typeof error === "object" && "code" in error && error.code === "23503") return Response.json({ error: "This record is still in use." }, { status: 409 });
  console.error(error);
  return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}
