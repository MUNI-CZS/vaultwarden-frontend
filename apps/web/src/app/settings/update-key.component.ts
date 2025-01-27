import { Component } from "@angular/core";
import { firstValueFrom } from "rxjs";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { UpdateKeyRequest } from "@bitwarden/common/models/request/update-key.request";
import { CryptoService } from "@bitwarden/common/platform/abstractions/crypto.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { MessagingService } from "@bitwarden/common/platform/abstractions/messaging.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { EncString } from "@bitwarden/common/platform/models/domain/enc-string";
import { CipherWithIdRequest } from "@bitwarden/common/vault//models/request/cipher-with-id.request";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { FolderService } from "@bitwarden/common/vault/abstractions/folder/folder.service.abstraction";
import { SyncService } from "@bitwarden/common/vault/abstractions/sync/sync.service.abstraction";
import { FolderWithIdRequest } from "@bitwarden/common/vault/models/request/folder-with-id.request";

@Component({
  selector: "app-update-key",
  templateUrl: "update-key.component.html",
})
export class UpdateKeyComponent {
  masterPassword: string;
  formPromise: Promise<any>;

  constructor(
    private apiService: ApiService,
    private i18nService: I18nService,
    private platformUtilsService: PlatformUtilsService,
    private cryptoService: CryptoService,
    private messagingService: MessagingService,
    private syncService: SyncService,
    private folderService: FolderService,
    private cipherService: CipherService,
    private logService: LogService
  ) {}

  async submit() {
    const hasUserKey = await this.cryptoService.hasUserKey();
    if (hasUserKey) {
      return;
    }

    if (this.masterPassword == null || this.masterPassword === "") {
      this.platformUtilsService.showToast(
        "error",
        this.i18nService.t("errorOccurred"),
        this.i18nService.t("masterPasswordRequired")
      );
      return;
    }

    try {
      this.formPromise = this.makeRequest().then((request) => {
        return this.apiService.postAccountKey(request);
      });
      await this.formPromise;
      this.platformUtilsService.showToast(
        "success",
        this.i18nService.t("keyUpdated"),
        this.i18nService.t("logBackInOthersToo"),
        { timeout: 15000 }
      );
      this.messagingService.send("logout");
    } catch (e) {
      this.logService.error(e);
    }
  }

  private async makeRequest(): Promise<UpdateKeyRequest> {
    const masterKey = await this.cryptoService.getMasterKey();
    const newUserKey = await this.cryptoService.makeUserKey(masterKey);
    const privateKey = await this.cryptoService.getPrivateKey();
    let encPrivateKey: EncString = null;
    if (privateKey != null) {
      encPrivateKey = await this.cryptoService.encrypt(privateKey, newUserKey[0]);
    }
    const request = new UpdateKeyRequest();
    request.privateKey = encPrivateKey != null ? encPrivateKey.encryptedString : null;
    request.key = newUserKey[1].encryptedString;
    request.masterPasswordHash = await this.cryptoService.hashMasterKey(
      this.masterPassword,
      await this.cryptoService.getOrDeriveMasterKey(this.masterPassword)
    );

    await this.syncService.fullSync(true);

    const folders = await firstValueFrom(this.folderService.folderViews$);
    for (let i = 0; i < folders.length; i++) {
      if (folders[i].id == null) {
        continue;
      }
      const folder = await this.folderService.encrypt(folders[i], newUserKey[0]);
      request.folders.push(new FolderWithIdRequest(folder));
    }

    const ciphers = await this.cipherService.getAllDecrypted();
    for (let i = 0; i < ciphers.length; i++) {
      if (ciphers[i].organizationId != null) {
        continue;
      }
      const cipher = await this.cipherService.encrypt(ciphers[i], newUserKey[0]);
      request.ciphers.push(new CipherWithIdRequest(cipher));
    }

    return request;
  }
}
