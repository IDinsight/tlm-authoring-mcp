/*
 * The two shapes the composer and the guide compiler share, in a leaf of
 * their own so neither imports the other for a type.
 */

/** A picture reference the composer resolves to a media entry the renderer takes. */
export type MediaRef = { name: string; nodeId: string; mark?: "answer" } | { name: string; relPath: string };

/** How the composer learns a picture's shape: the file's width over its height, or null when unreadable. */
export type RatioOf = (ref: MediaRef) => Promise<number | null>;
