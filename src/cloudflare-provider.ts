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

import {AppCheckToken, CustomProviderOptions} from 'firebase/app-check';

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

function getTurnstileWidgetId(turnstileDiv: HTMLElement | null) {
  if (turnstileDiv === null) {
    throw new Error('Turnstile div not found');
  }
  const widgetElm = turnstileDiv.getElementsByTagName('iframe')[0];
  if (widgetElm === null) {
    throw new Error('Turnstile widget not found');
  }
  const widgetId = widgetElm.getAttribute('id');
  if (widgetId === null) {
    throw new Error('Turnstile widget id not found');
  }
  return widgetId;
}

export class CloudFlareProviderOptions implements CustomProviderOptions {
  constructor(
    private _tokenExchangeUrl: string,
    private _siteKey: string
  ) {
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

  private makeDiv() {
    const div = document.createElement('div');
    div.id = turnstileDivId;
    div.className = turnstileClassName;
    div.setAttribute('style', 'display: none;');
    return div;
  }

  private makeScript() {
    const script = document.createElement('script');
    script.src = CLOUDFLARE_URL;
    return script;
  }

  getSiteKey(): string {
    return this._siteKey;
  }

  async getToken(): Promise<{
    readonly token: string;
    readonly expireTimeMillis: number;
  }> {
    return this.renderAndExchange(true);
  }

  async getLimitedUseToken(): Promise<{
    readonly token: string;
    readonly expireTimeMillis: number;
  }> {
    return this.renderAndExchange(true);
  }

  private async renderAndExchange(limitedUse: boolean): Promise<{
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
    const turnstileDiv = document.getElementById(turnstileDivId);
    const widgetId = getTurnstileWidgetId(turnstileDiv);
    const cloudFlareToken = turnstile.getResponse(widgetId);
    console.log('turnstile response', cloudFlareToken);
    // can't use callables, so we want to deploy an http method.
    // https://github.com/firebase/firebase-js-sdk/issues/6176
    // const tokenExchange = httpsCallable(functions, "fetchAppCheckToken");
    console.log('Starting exchange');
    // Sending limitedUseToken in the request for future limitedUseToken
    // specifiers in the admin sdk.
    const result = await fetch(this._tokenExchangeUrl, {
      method: 'POST',
      body: JSON.stringify({
        cloudflaretoken: cloudFlareToken,
        limiteduse: limitedUse,
      }),
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
    turnstile.reset(widgetId);
    return appCheckToken as AppCheckToken;
  }
}
