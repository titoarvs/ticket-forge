// The GraphQL documents for GitHub Projects. Each has an operation name (tests route on it).

const BOARD_FIELDS = `id number title url closed`;

/** The boards of the repository and of its owner (a user or an organization). */
export const BOARDS = `query Boards($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) { projectsV2(first: 50) { nodes { ${BOARD_FIELDS} } } }
  repositoryOwner(login: $owner) {
    ... on User { projectsV2(first: 50) { nodes { ${BOARD_FIELDS} } } }
    ... on Organization { projectsV2(first: 50) { nodes { ${BOARD_FIELDS} } } }
  }
}`;

/** One board with its fields (single-select options, iterations). */
export const BOARD = `query Board($id: ID!) {
  node(id: $id) { ... on ProjectV2 { ${BOARD_FIELDS}
    fields(first: 50) { nodes {
      __typename
      ... on ProjectV2FieldCommon { id name dataType }
      ... on ProjectV2SingleSelectField { options { id name } }
      ... on ProjectV2IterationField { configuration {
        iterations { id title }
        completedIterations { id title }
      } }
    } }
  } }
}`;

const VALUE_FIELD = `field { ... on ProjectV2FieldCommon { id } }`;

/** A page of the board's items: the issue each one is and its field values. */
export const ITEMS = `query BoardItems($id: ID!, $after: String) {
  node(id: $id) { ... on ProjectV2 {
    items(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id updatedAt
        content { __typename ... on Issue { number repository { nameWithOwner } } }
        fieldValues(first: 30) { nodes {
          __typename
          ... on ProjectV2ItemFieldSingleSelectValue { name ${VALUE_FIELD} }
          ... on ProjectV2ItemFieldNumberValue { number ${VALUE_FIELD} }
          ... on ProjectV2ItemFieldIterationValue { title ${VALUE_FIELD} }
        } }
      }
    }
  } }
}`;

export const ADD_ITEM = `mutation AddBoardItem($project: ID!, $content: ID!) {
  addProjectV2ItemById(input: { projectId: $project, contentId: $content }) { item { id updatedAt } }
}`;

/** Sets or clears several fields of one item in one request (one aliased mutation per field). */
export function setFieldsMutation(changes: { fieldId: string; value: any }[]) {
  const vars = changes.map(
    (_c, i) => `$f${i}: ID!${changes[i].value ? `, $v${i}: ProjectV2FieldValue!` : ''}`,
  );
  const calls = changes.map((c, i) =>
    c.value
      ? `s${i}: updateProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $f${i}, value: $v${i} }) { projectV2Item { id } }`
      : `s${i}: clearProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $f${i} }) { projectV2Item { id } }`,
  );
  return `mutation SetBoardFields($project: ID!, $item: ID!, ${vars.join(', ')}) {\n  ${calls.join('\n  ')}\n}`;
}
