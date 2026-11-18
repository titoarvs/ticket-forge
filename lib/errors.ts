// One shared way to raise an error that carries an HTTP status (api() in lib/server/http.ts sends it back as { error }).

/** An Error with a `status` (400 unless given). */
export const err = (message: string, status = 400) => Object.assign(new Error(message), { status });
