// Start an event handler immediately so preventDefault() and currentTarget
// are usable during native browser event dispatch. Catch both async and
// synchronous errors, reporting them through the supplied callback.
export function runSafely(job, onError) {
  try {
    return Promise.resolve(job()).catch(onError);
  } catch (error) {
    onError(error);
    return Promise.resolve();
  }
}
