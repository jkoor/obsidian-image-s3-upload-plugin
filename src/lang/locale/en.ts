// English

export default {
  "S3 upload": "S3 upload",
  "S3 credentials warning": "Credentials are stored unencrypted in this plugin's data.json and may be synced with your vault. Use a dedicated key limited to your image prefix.",
  "Endpoint": "Endpoint",
  "Region": "Region",
  "Bucket": "Bucket",
  "Access Key ID": "Access Key ID",
  "Secret Access Key": "Secret Access Key",
  "Session Token": "Session Token (optional)",
  "Public base URL": "Public base URL",
  "Object prefix": "Object prefix",
  "Path style": "Path-style addressing",
  "Path style description": "Use endpoint/bucket/key instead of bucket.endpoint/key. Enable for services such as local MinIO.",
  "Public URL description": "The public base URL maps to the bucket root, including any CDN path. Images must be readable through this URL; uploading does not grant public access.",
  "Safe deletion description": "Move originals to trash only after replacing links and checking other notes. Incomplete or stale metadata keeps the original file.",
  "Configure S3": "Complete the S3 settings first",
  "Operation failed": "Operation failed",
  "Operation cancelled": "Operation cancelled",
  "Upload failed": "Upload failed; please retry with the original image",
  "Uploaded URL copied": "Uploaded image URL copied to clipboard",
  "Upload already running": "An image upload is already running for this note",
  "Source preserved": "Original image preserved because its references could not be verified",
  "Upload result": "Upload result",
  "Download result": "Download result",
  "Success": "Success",
  "Failed": "Failed",
  "Skipped": "Skipped",
  // setting.ts
  "Plugin Settings": "Plugin Settings",
  "Auto pasted upload": "Auto pasted upload",
  "If you set this value true, when you paste image, it will be auto uploaded(you should set the picGo server rightly)":
    "If you set this value true, when you paste image, it will be auto uploaded(you should set the picGo server rightly)",
  "Default uploader": "Default uploader",
  "PicGo server": "PicGo server upload route",
  "PicGo server desc":
    "upload route, use PicList will be able to set picbed and config through query",
  "Please input PicGo server": "Please input upload route",
  "PicGo delete server":
    "PicGo server delete route(you need to use PicList app)",
  "PicList desc": "Search PicList on Github to download and install",
  "Please input PicGo delete server": "Please input delete server",
  "Delete image using PicList": "Delete image using PicList",
  "PicGo-Core path": "PicGo-Core path",
  "Delete successfully": "Delete successfully",
  "Delete failed": "Delete failed",
  "Image size suffix": "Image size suffix",
  "Image size suffix Description": "like |300 for resize image in ob.",
  "Please input image size suffix": "Please input image size suffix",
  "Error, could not delete": "Error, could not delete",
  "Please input PicGo-Core path, default using environment variables":
    "Please input PicGo-Core path, default using environment variables",
  "Work on network": "Work on network",
  "Work on network Description":
    "Allow upload network image by 'Upload all' command.\n Or when you paste, md standard image link in your clipboard will be auto upload.",
  "Upload when clipboard has image and text together":
    "Upload when clipboard has image and text together",
  "When you copy, some application like Excel will image and text to clipboard, you can upload or not.":
    "When you copy, some application like Excel will image and text to clipboard, you can upload or not.",
  "Network Domain Black List": "Network Domain Black List",
  "Network Domain Black List Description":
    "Image in the domain list will not be upload,use comma separated",
  "Delete source file after you upload file":
    "Delete source file after you upload file",
  "Delete source file in ob assets after you upload file.":
    "Delete source file in ob assets after you upload file.",
  "Image desc": "Image desc",
  reserve: "default",
  "remove all": "none",
  "remove default": "remove image.png",
  "Remote server mode": "Remote server mode",
  "Remote server mode desc":
    "If you have deployed piclist-core or piclist on the server.",
  "Can not find image file": "Can not find image file",
  "File has been changedd, upload failure":
    "File has been changedd, upload failure",
  "File has been changedd, download failure":
    "File has been changedd, download failure",
  "Warning: upload files is different of reciver files from api":
    "Warning: upload files num is different of reciver files from api",
  upload: "Upload",
};
