"""Read only bounded, credential-free login diagnostics from the test environment."""
import collections
import json
import pathlib
import re
import sys


def main():
    """Print known diagnostic fields while excluding all other application log content."""
    if len(sys.argv) != 2 or sys.argv[1] != 'admin.test.brandmasterskaya.ru':
        raise SystemExit('Only the test admin environment is allowed')
    log_path = pathlib.Path.home() / 'private' / sys.argv[1] / 'app.log'
    records = collections.deque(maxlen=5)
    stages = {'token_request', 'token_response', 'identity_verification', 'member_storage', 'session_cookie'}
    if log_path.is_file():
        with log_path.open(errors='replace') as log_file:
            for line in log_file:
                if 'cabinet login failed:' not in line:
                    continue
                try:
                    record = json.loads(line.split('cabinet login failed:', 1)[1])
                    if record.get('stage') not in stages:
                        continue
                    code = record.get('code', '')
                    if not re.fullmatch(r'(?:ERR_[A-Z_]+|UND_ERR_[A-Z_]+|unclassified)', code):
                        continue
                    safe = {'stage': record['stage'], 'code': code}
                    if isinstance(record.get('status'), int) and 0 <= record['status'] <= 599:
                        safe['status'] = record['status']
                    if record.get('claim') in ['iss', 'aud', 'exp', 'iat', 'sub', 'id']:
                        safe['claim'] = record['claim']
                    records.append(safe)
                except (ValueError, TypeError):
                    continue
    for record in records:
        print(json.dumps(record))
    if not records:
        print('No bounded login diagnostics recorded yet')


main()
