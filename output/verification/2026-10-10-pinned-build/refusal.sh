#!/bin/zsh
# In the API image built from this commit, one lock line installed four ways. Downloads aiofiles
# (~15 KB) inside Docker only.
#   right:    both files' hashes as locked: the wheel is taken.
#   one-off:  the wheel's hash changed: pip never takes the wheel, only the other listed file.
#   wrong:    both hashes changed: no file matches, refused.
#   bare:     no hash: refused in --require-hashes mode.
set -u
dir=${0:A:h}/refusal; mkdir -p $dir
awk '/^aiofiles==/{p=1} p{print} p&&!/\\$/{exit}' ${0:A:h}/../../../backend/requirements.lock > $dir/right.lock
sed 's/abe311e5/00000000/' $dir/right.lock > $dir/one-off.lock
sed 's/abe311e5/00000000/; s/a8d728f0/00000000/' $dir/right.lock > $dir/wrong.lock
echo "aiofiles==25.1.0" > $dir/bare.lock
for f in right one-off wrong bare; do
  echo "== $f.lock"; cat $dir/$f.lock
  ~/.docker/bin/docker run --rm --pull never --user 0 -v $dir:/locks:ro --entrypoint pip birka-ci-local-api \
    install --no-deps --require-hashes --no-cache-dir --disable-pip-version-check --target /tmp/t -r /locks/$f.lock 2>&1 \
    | grep -E "Downloading|Successfully installed|DO NOT MATCH|Expected sha256|Got  |Hashes are required" | cut -c1-160
  echo "exit: $pipestatus[1]"
done
