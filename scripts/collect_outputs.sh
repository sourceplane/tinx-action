#!/usr/bin/env bash
set -euo pipefail

mappings="${OUTPUT_MAPPINGS:-}"
json='{}'

if [[ -n "${mappings}" ]]; then
  while IFS= read -r line; do
    entry="$(echo "${line}" | xargs)"
    [[ -z "${entry}" ]] && continue

    if [[ "${entry}" != *=* ]]; then
      echo "error: invalid outputs entry '${entry}', expected 'name=path'" >&2
      exit 1
    fi

    key="${entry%%=*}"
    path="${entry#*=}"
    key="$(echo "${key}" | xargs)"
    path="$(echo "${path}" | xargs)"

    if [[ -z "${key}" || -z "${path}" ]]; then
      echo "error: invalid outputs entry '${entry}', key and path are required" >&2
      exit 1
    fi

    if [[ ! -f "${path}" ]]; then
      echo "error: output file not found for '${key}': ${path}" >&2
      exit 1
    fi

    value="$(cat "${path}")"

    {
      echo "${key}<<__TINX_OUTPUT_EOF__"
      printf '%s\n' "${value}"
      echo "__TINX_OUTPUT_EOF__"
    } >> "$GITHUB_OUTPUT"

    escaped_value="$(printf '%s' "${value}" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
    json="$(printf '%s' "${json}" | python3 -c 'import json,sys; key=sys.argv[1]; val=json.loads(sys.argv[2]); obj=json.load(sys.stdin); obj[key]=val; print(json.dumps(obj))' "${key}" "${escaped_value}")"
  done <<< "${mappings}"
fi

{
  echo "outputs-json<<__TINX_JSON_EOF__"
  printf '%s\n' "${json}"
  echo "__TINX_JSON_EOF__"
} >> "$GITHUB_OUTPUT"
