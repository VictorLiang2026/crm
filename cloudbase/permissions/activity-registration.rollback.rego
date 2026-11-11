package authz.user
mcp_methods := {
  "/.well-known/oauth-protected-resource/mcp/knowledge": "GET",
  "/.well-known/oauth-authorization-server/knowledge-mcp": "GET",
  "/oauth/register": "POST",
  "/oauth/authorize": "GET",
  "/oauth/token": "POST",
  "/oauth/revoke": "POST",
  "/mcp/knowledge": "POST"
}
mcp_public_request if {
  input.cloudbase.resource_type == "functions"
  input.cloudbase.entrypoint_type == "tcbgateway"
  input.request.host == "crm-d1gkae8ddc930d151.ap-shanghai.app.tcloudbase.com"
  input.subject.auth_type in {"anonymous", "unauthenticated", "anon"}
  mcp_methods[input.request.path] == input.request.method
}
allow if { mcp_public_request }
deny contains "anonymous access to functions is not allowed" if {
  input.cloudbase.resource_type == "functions"
  input.subject.auth_type in {"anonymous", "unauthenticated", "anon"}
  not mcp_public_request
}
