/**
 * What the CLIENT may do about moving one of their visits — the field
 * `clientMove`, the ONLY source of these strings (Law 6). Answered by
 * `MoveSystem.clientMove`: the visit is theirs to move (the free window
 * still allows it AND a seat on it is theirs to name), only the shop can
 * move it (the window allows it, but nothing on it is the client's), or no
 * move is offered at all.
 */
export const ClientMove = {
  /** «Премести» is offered — the window allows it and a seat is the booker's. */
  Movable: 'MOVABLE',
  /** The window allows it, but only the shop can move what is on it. */
  ShopOnly: 'SHOP_ONLY',
  /** No move: the window (or the lifecycle) no longer allows one. */
  None: 'NONE',
} as const;
export type ClientMove = (typeof ClientMove)[keyof typeof ClientMove];
