#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"

cd "${repo_root}"

output_root="${CCV_STANDALONE_OUTPUT_DIR:-temp-pack/standalone}"
version="$(node -e "console.log(require('./package.json').version)")"
platform="$(uname -s | tr '[:upper:]' '[:lower:]')"
raw_arch="$(uname -m)"
case "${raw_arch}" in
  x86_64 | amd64)
    arch="amd64"
    ;;
  aarch64 | arm64)
    arch="arm64"
    ;;
  *)
    arch="$(printf "%s" "${raw_arch}" | tr '[:upper:]' '[:lower:]')"
    ;;
esac
timestamp="$(date +%Y%m%d-%H%M%S)"

bundle_name="codex-viewer-${version}-${platform}-${arch}-${timestamp}"
bundle_dir="${output_root}/${bundle_name}"
archive_path="${output_root}/${bundle_name}.tar.gz"

mkdir -p "${output_root}"

echo "[standalone] Building frontend/backend bundles"
pnpm build

echo "[standalone] Deploying production dependencies"
pnpm --filter . deploy --legacy --prod "${bundle_dir}"

launcher_path="${bundle_dir}/codex-viewer"
cat > "${launcher_path}" <<'EOF'
#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "${script_dir}/dist/main.js" "$@"
EOF

chmod +x "${launcher_path}"

echo "[standalone] Creating archive: ${archive_path}"
tar -C "${output_root}" -czf "${archive_path}" "${bundle_name}"
shasum -a 256 "${archive_path}" > "${archive_path}.sha256"

echo "[standalone] Done"
echo "  bundle_dir: ${bundle_dir}"
echo "  archive:    ${archive_path}"
echo "  checksum:   ${archive_path}.sha256"
