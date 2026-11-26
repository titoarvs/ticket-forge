// The GraphQL documents for GitHub Projects. Each has an operation name (tests route on it). All
// are queries: Ticket Forge only reads GitHub Projects (gql() refuses mutations).

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
