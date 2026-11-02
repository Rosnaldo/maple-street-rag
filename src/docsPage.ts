const SWAGGER_UI = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.32.0";

/**
 * Swagger UI page with the OpenAPI spec embedded, so the docs need a single
 * route (/docs) instead of a separate JSON endpoint for the UI to fetch.
 */
export function renderDocsPage(spec: unknown, title: string): string {
  // "<" escaped so text inside the spec can never close the <script> tag.
  const specJson = JSON.stringify(spec).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="${SWAGGER_UI}/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${SWAGGER_UI}/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({ spec: ${specJson}, dom_id: "#swagger-ui" });
  </script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);
}
