import { ensureDir, v4, MultipartReader, move } from "./deps.ts";

const uploadMiddleware = function (
  path: string,
  extensions: Array<string> = [],
  maxSizeBytes: number = Number.MAX_SAFE_INTEGER,
  maxFileSizeBytes: number = Number.MAX_SAFE_INTEGER,
  useCurrentDir: boolean = true,
) {
  return async function (context: any, next: any) {
    if (
      parseInt(context.request.headers.get("content-length")) > maxSizeBytes
    ) {
      context.throw(
        422,
        `Maximum total upload size exceeded, size: ${context.request.headers.get("content-length")} bytes, maximum: ${maxSizeBytes} bytes.`,
      );
      next();
    }
    const boundaryRegex = /^multipart\/form-data;\sboundary=(?<boundary>.*)$/;
    let match: RegExpMatchArray | null;
    if (
      context.request.headers.get("content-type") &&
      (match = context.request.headers.get("content-type")!.match(
        boundaryRegex,
      ))
    ) {
      const formBoundary: string = match.groups!.boundary;
      const mr = new MultipartReader(
        context.request.serverRequest.body,
        formBoundary,
      );
      const form = await mr.readForm(0);
      let res: any = {};
      let entries: any = Array.from(form.entries());
      for (const item of entries) {
        if (item[1].filename != undefined) {
          if (extensions.length > 0) {
            let ext = item[1].filename.split(".").pop();
            if (!extensions.includes(ext)) {
              for (const delItem of entries) {
                if (delItem[1].tempfile != undefined) {
                  await Deno.remove(delItem[1].tempfile);
                }
              }
              context.throw(
                422,
                `The file extension is not allowed (${ext} in ${
                  item[1].filename
                }). Allowed extensions: ${extensions}.`,
              );
              next();
            } else if (item[1].size > maxFileSizeBytes) {
              for (const delItem of entries) {
                if (delItem[1].tempfile != undefined) {
                  await Deno.remove(delItem[1].tempfile);
                }
              }
              context.throw(
                422,
                `Maximum file upload size exceeded, file: ${
                  item[1].filename
                }, size: ${item[1].size} bytes, maximum: ${maxFileSizeBytes} bytes.`,
              );
              next();
            }
          }
        }
      }
      for (const item of entries) {
        let fileData: any = item[1];
        let formField = item[0];
        if (fileData.tempfile != undefined) {
          const uuid = v4.generate(); //TODO improve to use of v5
          const d = new Date();
          const uploadPath =
            (`${path}/${d.getFullYear()}/${d.getMonth()}/${d.getDay()}/${d.getHours()}/${d.getMinutes()}/${d.getSeconds()}/${uuid}`);
          let fullPath = uploadPath;
          if (useCurrentDir) {
            fullPath = `${Deno.cwd()}/${fullPath}`;
          }
          await ensureDir(fullPath);
          await move(
            fileData.tempfile,
            `${fullPath}/${fileData.filename}`,
          );
          res[formField] = fileData;
          delete res[formField]["tempfile"];
          res[formField]["url"] = encodeURI(
            `${uploadPath}/${fileData.filename}`,
          );
          res[formField]["uri"] = `${fullPath}/${fileData.filename}`;
        }
      }
      context["uploadedFiles"] = res;
    } else {
      context.throw(
        422,
        'Invalid upload data, request must contains a body with form with enctype="multipart/form-data", and inputs with type="file". For a while, it does not support input with multiple attribute, but you can work around this in javascript by creating a virtual form and adding an input element for each "file" object in ("input [type = file]").files.',
      );
    }
    next();
  };
};
const preUploadValidateMiddleware = function (
  extensions: Array<string> = [],
  maxSizeBytes: number = Number.MAX_SAFE_INTEGER,
  maxFileSizeBytes: number = Number.MAX_SAFE_INTEGER,
) {
  return async (context: any, next: any) => {
    let jsonData = await context.request.body();
    jsonData = jsonData["value"];
    let totalBytes = 0;
    let validatios = "";
    for (const iName in jsonData) {
      totalBytes += jsonData[iName].size;
      if (jsonData[iName].size > maxFileSizeBytes) {
        validatios += `Maximum file upload size exceeded, file: ${
          jsonData[iName].name
        }, size: ${jsonData[iName].size} bytes, maximum: ${maxFileSizeBytes} bytes. `;
      }
      if (!extensions.includes(jsonData[iName].name.split(".").pop())) {
        validatios += `The file extension is not allowed (${
          jsonData[iName].name.split(".").pop()
        } in ${jsonData[iName].name}). Allowed extensions: ${extensions}. `;
      }
    }
    if (totalBytes > maxSizeBytes) {
      validatios += `Maximum total upload size exceeded, size: ${
        totalBytes
      } bytes, maximum: ${maxSizeBytes} bytes. `;
    }
    if (validatios != "") {
      context.throw(422, validatios);
    }
    next();
  };
};
export { uploadMiddleware, preUploadValidateMiddleware };
