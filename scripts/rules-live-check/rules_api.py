import os, json, sys, urllib.request
from google.oauth2 import service_account
import google.auth.transport.requests as tr
P='ghapp-a530d'
c = service_account.Credentials.from_service_account_file(os.path.expanduser('~/.config/nexo/firebase-sa.json'), scopes=['https://www.googleapis.com/auth/cloud-platform','https://www.googleapis.com/auth/firebase'])
c.refresh(tr.Request())
def call(method, path, body=None):
    req = urllib.request.Request('https://firebaserules.googleapis.com/v1/'+path, method=method, data=json.dumps(body).encode() if body is not None else None,
        headers={'Authorization':'Bearer '+c.token,'Content-Type':'application/json'})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=60).read())
    except urllib.error.HTTPError as e:
        return {'error': e.code, 'body': e.read().decode()[:1500]}
