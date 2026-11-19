'use client';
// The board: header and sprint, filters and lanes, then the columns of cards. The parts are in
// client/Board/board/.
import { S } from '../core';
import { useBoard } from './board/use-board';
import { BoardHead, NoSprint, BoardEmpty } from './board/board-head';
import { BoardControls } from './board/controls';
import { BoardGrid } from './board/grid';

export function Board() {
  const b = useBoard();
  const noSprint = b.p.sprints.length > 0 && !b.act && !S.boardAll;
  return (
    <>
      <BoardHead b={b} />
      {noSprint ? (
        <NoSprint projectId={b.p.id} />
      ) : (
        <>
          <BoardControls b={b} />
          <BoardGrid b={b} />
          {!b.list.length && <BoardEmpty b={b} />}
        </>
      )}
    </>
  );
}
