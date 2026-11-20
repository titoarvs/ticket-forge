export { GET } from './_route/get';
export { POST } from './_route/post';

// A round runs after the response (after()), so it needs the longest time Vercel allows. Route
// settings must be written in the route file itself.
export const maxDuration = 300;
