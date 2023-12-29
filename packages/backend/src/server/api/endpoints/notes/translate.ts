/*
 * SPDX-FileCopyrightText: syuilo and other misskey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { URLSearchParams } from 'node:url';
import { Injectable } from '@nestjs/common';
import googletr from '@vitalets/google-translate-api';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { MetaService } from '@/core/MetaService.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { GetterService } from '@/server/api/GetterService.js';
import { RoleService } from '@/core/RoleService.js';
import { ApiError } from '../../error.js';

export const meta = {
	tags: ['notes'],

	requireCredential: true,
	kind: 'read:account',

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			sourceLang: { type: 'string' },
			text: { type: 'string' },
		},
	},

	errors: {
		unavailable: {
			message: 'Translate of notes unavailable.',
			code: 'UNAVAILABLE',
			id: '50a70314-2d8a-431b-b433-efa5cc56444c',
		},
		noSuchNote: {
			message: 'No such note.',
			code: 'NO_SUCH_NOTE',
			id: 'bea9b03f-36e0-49c5-a4db-627a029f8971',
		},
		noTranslateService: {
			message: 'Translate service is not available.',
			code: 'NO_TRANSLATE_SERVICE',
			id: 'bef6e895-c05d-4499-9815-035ed18b0e31',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		noteId: { type: 'string', format: 'misskey:id' },
		targetLang: { type: 'string' },
	},
	required: ['noteId', 'targetLang'],
} as const;

const translatorServices = [
	'DeepL',
	'GoogleNoAPI',
];

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private noteEntityService: NoteEntityService,
		private getterService: GetterService,
		private metaService: MetaService,
		private httpRequestService: HttpRequestService,
		private roleService: RoleService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const policies = await this.roleService.getUserPolicies(me.id);
			if (!policies.canUseTranslator) {
				throw new ApiError(meta.errors.unavailable);
			}

			const note = await this.getterService.getNote(ps.noteId).catch(err => {
				if (err.id === '9725d0ce-ba28-4dde-95a7-2cbb2c15de24') throw new ApiError(meta.errors.noSuchNote);
				throw err;
			});

			if (!(await this.noteEntityService.isVisibleForMe(note, me.id))) {
				return 204; // TODO: 良い感じのエラー返す
			}

			if (note.text == null) {
				return 204;
			}

			const instance = await this.metaService.fetch();

			if (instance.translatorType == null || !translatorServices.includes(instance.translatorType)) {
				throw new ApiError(meta.errors.noTranslateService);
			}

			if (instance.translatorType === 'DeepL') {
				if (instance.deeplAuthKey == null) {
					return 204; // TODO: 良い感じのエラー返す
				}
		
				let targetLang = ps.targetLang;
				if (targetLang.includes('-')) targetLang = targetLang.split('-')[0];
		
				const params = new URLSearchParams();
				params.append('auth_key', instance.deeplAuthKey);
				params.append('text', note.text);
				params.append('target_lang', targetLang);
		
				const endpoint = instance.deeplIsPro ? 'https://api.deepl.com/v2/translate' : 'https://api-free.deepl.com/v2/translate';
		
				const res = await fetch(endpoint, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/x-www-form-urlencoded',
						'User-Agent': config.userAgent,
						Accept: 'application/json, */*',
					},
					body: params,
					// TODO
					//timeout: 10000,
					agent: getAgentByUrl,
				});
		
				const json = (await res.json()) as {
					translations: {
						detected_source_language: string;
						text: string;
					}[];
				};	
		
				return {
					sourceLang: json.translations[0].detected_source_language,
					text: json.translations[0].text,
					translator: translatorServices,
				};
			} else if (instance.translatorType === 'GoogleNoAPI') {
				let targetLang = ps.targetLang;
				if (targetLang.includes('-')) targetLang = targetLang.split('-')[0];
		
				const json = await googletr(note.text, { to: targetLang });
		
				return {
					sourceLang: json.from.language.iso,
					text: json.text,
					translator: translatorServices,
				};
			}

			return 204; // TODO: 良い感じのエラー返す
		});
	}
}
