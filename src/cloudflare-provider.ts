/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {AppCheckToken, CustomProvider} from 'firebase/app-check';

const CLOUDFLARE_URL =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onloadTurnstileCallback';
const turnstileDivId = 'turnstyle';
const turnstileClassName = 'cf-turnstile';

let promiseResolve: (value: unknown) => void;
const readyTurnstile = new Promise(resolve => {
  promiseResolve = resolve;
});

let token: AppCheckToken | null = null;
let tokenExpireTimeMillis = 0;

function getTokenConstructor(tokenExchangeUrl: string) {
  return async function getToken(): Promise<{
    readonly token: string;
    readonly expireTimeMillis: number;
  }> {
    if (token !== null && tokenExpireTimeMillis > Date.now()) {
      console.log('reuse token');
      return token;
    }
    console.log('Getting app check token');
    await readyTurnstile;
    console.log('Turnstile ready');
    const cloudFlareToken = turnstile.getResponse(turnstileDivId);
    console.log('turnstile response', cloudFlareToken);
    // can't use callables, so we want to deploy an http method.
    // https://github.com/firebase/firebase-js-sdk/issues/6176
    // const tokenExchange = httpsCallable(functions, "fetchAppCheckToken");
    console.log('Starting exchange');
    const result = await fetch(tokenExchangeUrl, {
      method: 'POST',
      body: JSON.stringify({cloudflaretoken: cloudFlareToken}),
      headers: {
        'Content-Type': 'application/json',
      },
    });
    const resultJson = await result.json();
    const appCheckToken = resultJson;
    console.log('exchange complete', appCheckToken);
    if ((appCheckToken as AppCheckToken).token === '') {
      console.log('Invalid CloudFlare token');
      throw new Error('Invalid CloudFlare token');
    }
    token = appCheckToken as AppCheckToken;
    tokenExpireTimeMillis = Date.now() + 1000 * 60 * 60; // appCheckToken.expireTimeMillis;
    console.log('appchecktokenacquired', appCheckToken);
    turnstile.reset(turnstileDivId);
    return appCheckToken as AppCheckToken;
  };
}

export class CloudFlareProvider extends CustomProvider {
  constructor(
    private _siteKey: string,
    private _tokenExchangeUrl: string
  ) {
    const getToken = getTokenConstructor(_tokenExchangeUrl);
    super({getToken});
    const body: HTMLElement = document.body;
    const turnstileElement = this.makeDiv();
    body.appendChild(turnstileElement);
    body.appendChild(this.makeScript());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).onloadTurnstileCallback = () => {
      turnstile.render(turnstileElement, {
        sitekey: this._siteKey,
        callback: (token: string) => {
          console.log(`Challenge Result: ${token}`);
          promiseResolve(true);
        },
      });
    };
  }

  makeDiv() {
    const div = document.createElement('div');
    div.id = turnstileDivId;
    div.className = turnstileClassName;
    div.setAttribute('style', 'display: none;');
    return div;
  }

  makeScript() {
    const script = document.createElement('script');
    script.src = CLOUDFLARE_URL;
    return script;
  }
}
